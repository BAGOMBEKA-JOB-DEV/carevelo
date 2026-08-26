<?php

namespace App\Services\Payments\Pesapal;

use App\Models\AggregatorAccount;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\CollectionHandoff;
use App\Services\Payments\GatewayStatus;
use App\Support\TenantCache;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * The HTTP half of Pesapal, which holds a Bank of Uganda Payment System
 * Operator licence.
 *
 * TWO MERCHANTS USE THIS CLASS, AND THEY ARE NOT THE SAME KIND OF THING.
 *
 * For a patient's payment, the licensed party is the aggregator, the merchant is
 * THE CLINIC, and Carevelo is the software calling their API on the clinic's
 * behalf with the clinic's own consumer key and secret. Funds move patient ->
 * Pesapal -> clinic and never touch an account we own, because no such account
 * exists in that path.
 *
 * For a clinic's SUBSCRIPTION to the software, the merchant is CAREVELO and the
 * credentials come from configuration. That is our own revenue -- ADR-0003
 * SS-Consequences: "Revenue is subscription-only" -- and it is the only money
 * this company collects. It travels a different table, a different resolver and
 * a different notification endpoint; the only thing the two share is this class,
 * which is transport.
 *
 * Sharing transport is the safe half of the sharing. What must never be shared
 * is a table, an account lookup or a resolver, because that is how clinic money
 * and Carevelo money end up on one code path and how custody arrives by
 * accident. The seam is PesapalCredentials: this class cannot tell which
 * merchant it is speaking for beyond deciding where a token may be cached, and
 * no caller holding one kind can obtain the other.
 *
 * THREE RULES THIS CLASS EXISTS TO KEEP.
 *
 * 1. The bearer token and the consumer secret never leave this class. They are
 *    not logged, not audited, not put in an exception message, and not returned
 *    to any caller. AggregatorUnavailable is thrown WITHOUT a `previous`,
 *    because an HTTP client exception carries the request, the request carries
 *    the Authorization header, and that header is a merchant's credential.
 *
 * 2. Every response body is scrubbed of the calling credentials before anything
 *    reads it. Pesapal echoes the consumer key in some error messages, and those
 *    messages are surfaced to an administrator verbatim -- so the scrub happens
 *    at the point of decoding rather than at each of the places text is later
 *    used, where one omission would be enough.
 *
 * 3. An unreadable answer is an error, never a guess. A malformed body raises
 *    AggregatorUnavailable so the caller backs off and asks again; inventing a
 *    status here would confirm a booking nobody paid for, or record a
 *    subscription nobody settled.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
final class PesapalClient
{
    private const SANDBOX_BASE_URL = 'https://cybqa.pesapal.com/pesapalv3';

    private const LIVE_BASE_URL = 'https://pay.pesapal.com/v3';

    /** Short. A reconciliation sweep must not queue behind a hung aggregator. */
    private const TIMEOUT_SECONDS = 10;

    /**
     * Four minutes against Pesapal's five.
     *
     * The margin is not politeness. A token that expires between the moment it
     * is read from the cache and the moment Pesapal validates it produces a 401
     * on a SubmitOrderRequest -- which the patient experiences as a payment
     * that failed for no reason, at the counter, with a queue behind them. Sixty
     * seconds is more slack than any call here can consume, since every request
     * gives up after ten.
     */
    private const TOKEN_TTL_SECONDS = 240;

    /**
     * Pesapal's own name for its notification mechanism, and the only value we
     * ever register. A GET registration would let a notification arrive as a
     * link someone could click out of a browser history.
     */
    private const IPN_NOTIFICATION_TYPE = 'POST';

    public function __construct(
        private readonly TenantCache $cache,

        /**
         * The unprefixed store, used for the PLATFORM token and nothing else.
         *
         * TenantCache is the right tool for a clinic's token and the wrong one
         * for Carevelo's, in two ways that both bite. It throws without a bound
         * tenant, so the notification endpoint -- which runs with none -- could
         * not cache at all. Worse, when a token IS minted inside some tenant's
         * context, TenantCache would file the platform's credential under that
         * clinic's prefix: correct-looking, cached per clinic, and one shared
         * cache store away from being served to the wrong session.
         *
         * So the platform key is explicit and global, and the tenant key stays
         * unreachable from it.
         */
        private readonly Repository $platformCache,
    ) {}

    // --- The clinic's own merchant account ---------------------------------
    //
    // Every method here collects a PATIENT'S payment into THE CLINIC'S account.
    // They are thin on purpose: the account is turned into credentials and the
    // work happens below, on the shared path.

    /**
     * A bearer token for this clinic's own merchant account.
     */
    public function token(AggregatorAccount $account): string
    {
        return $this->tokenUsing(PesapalCredentials::forAccount($account));
    }

    /**
     * Prove the clinic's credentials without moving anything.
     *
     * This is the whole of what verification needs: Pesapal either issues a
     * token for these credentials or it does not. No order is submitted, no
     * collection is attempted, nobody is charged a shilling to prove a
     * configuration -- and there would be no platform account for that shilling
     * to land in if they were, because the platform account collects
     * subscriptions and is unreachable from here.
     */
    public function assertCredentialsWork(AggregatorAccount $account): void
    {
        $this->token($account);
    }

    /**
     * The registered IPN id for a URL, registering it only if it is not there.
     *
     * RegisterIPN is NOT idempotent: calling it twice with the same URL yields
     * two registrations and two notifications per event. So GetIpnList is
     * consulted first and the existing id reused. The caller stores the result
     * against the account, which makes this a once-per-clinic call in practice
     * rather than a once-per-payment one.
     */
    public function ipnIdFor(AggregatorAccount $account, string $url): string
    {
        return $this->ipnIdUsing(PesapalCredentials::forAccount($account), $url);
    }

    /**
     * Tell Pesapal a collection is expected, and get the page the patient pays on.
     *
     * The order is submitted with the CLINIC'S OWN credentials against the
     * CLINIC'S OWN merchant account, so the money Pesapal collects settles to
     * the clinic and never to us. What comes back is a tracking id and a URL --
     * no funds, no balance, nothing held.
     *
     * @param  array<string, mixed>  $order  the SubmitOrderRequest body, built by the gateway
     */
    public function submitOrder(AggregatorAccount $account, array $order): CollectionHandoff
    {
        return $this->submitOrderUsing(PesapalCredentials::forAccount($account), $order);
    }

    /**
     * Ask Pesapal what became of an order.
     *
     * THE ONLY SOURCE OF TRUTH about a Pesapal collection. Pesapal's inbound
     * notification carries no status and no signature, deliberately: it is a
     * prompt to make this call, not an answer. Everything the system believes
     * about a Pesapal payment is read here, over TLS, authenticated with the
     * clinic's own credentials.
     */
    public function transactionStatus(AggregatorAccount $account, string $trackingId): GatewayStatus
    {
        return $this->transactionStatusUsing(PesapalCredentials::forAccount($account), $trackingId);
    }

    // --- Either merchant, named explicitly ---------------------------------
    //
    // Subscription billing calls these directly with PesapalCredentials::
    // forPlatform(). It cannot reach the methods above, because it has no
    // AggregatorAccount and there is no row it could construct one from.

    /**
     * A bearer token for whichever merchant these credentials name.
     *
     * Cached per CREDENTIAL SET rather than per tenant or globally. For a clinic
     * TenantCache prefixes the key with the tenant, so a key built here cannot be
     * read by another tenant even by accident; the identity in the key means a
     * clinic that rotates its credentials, or holds accounts at two aggregators,
     * cannot be handed a token minted from the other set. For the platform the
     * identity is a hash of the consumer key, which gives rotation the same
     * property without a tenant to hang it on.
     *
     * The token is a secret at rest in the cache for four minutes. That is the
     * whole of its life and it is the price of not authenticating on every
     * call; nothing else about it is written down anywhere.
     */
    public function tokenUsing(PesapalCredentials $credentials): string
    {
        $cached = $this->readCachedToken($credentials);

        // Read-then-write rather than remember(), so that an entry which is not
        // a usable token -- a mis-serialised value, a poisoned shared cache --
        // is DISCARDED rather than sent as an Authorization header. remember()
        // would hand it straight back.
        if ($cached !== null) {
            return $cached;
        }

        $token = $this->requestToken($credentials);

        $this->writeCachedToken($credentials, $token);

        return $token;
    }

    /** Prove a credential set without moving anything. */
    public function assertCredentialsWorkUsing(PesapalCredentials $credentials): void
    {
        $this->tokenUsing($credentials);
    }

    /**
     * The registered IPN id for a URL, registering it only if it is not there.
     */
    public function ipnIdUsing(PesapalCredentials $credentials, string $url): string
    {
        $existing = $this->findRegisteredIpn($credentials, $url);

        if ($existing !== null) {
            return $existing;
        }

        $body = $this->decode($credentials, $this->send(
            $credentials,
            fn (PendingRequest $request, string $base): Response => $request->post(
                $base.'/api/URLSetup/RegisterIPN',
                ['url' => $url, 'ipn_notification_type' => self::IPN_NOTIFICATION_TYPE],
            ),
        ));

        $this->refuseOnError($body);

        $id = $this->nonEmptyString($body['ipn_id'] ?? null);

        if ($id === null) {
            throw new AggregatorUnavailable('The aggregator did not return a notification id.');
        }

        return $id;
    }

    /**
     * Submit an order and get back where the payer is sent.
     *
     * Moves no money in either direction. It tells Pesapal that a collection is
     * expected against the merchant account these credentials name, and returns
     * a tracking id and a URL.
     *
     * @param  array<string, mixed>  $order  the SubmitOrderRequest body
     */
    public function submitOrderUsing(PesapalCredentials $credentials, array $order): CollectionHandoff
    {
        $body = $this->decode($credentials, $this->send(
            $credentials,
            fn (PendingRequest $request, string $base): Response => $request->post(
                $base.'/api/Transactions/SubmitOrderRequest',
                $order,
            ),
        ));

        $this->refuseOnError($body);

        $trackingId = $this->nonEmptyString($body['order_tracking_id'] ?? null);
        $redirectUrl = $this->nonEmptyString($body['redirect_url'] ?? null);

        if ($trackingId === null || $redirectUrl === null) {
            throw new AggregatorUnavailable('The aggregator did not return a usable payment handoff.');
        }

        // A redirect URL is where a BROWSER is sent. Accepting an arbitrary
        // string here would make a compromised or mistaken response into an open
        // redirect with a clinic's name on it, so only an https URL on Pesapal's
        // own host is honoured.
        if (! $this->isPesapalUrl($redirectUrl, $credentials)) {
            throw new AggregatorUnavailable('The aggregator returned a payment page we will not send a payer to.');
        }

        return CollectionHandoff::to($trackingId, $redirectUrl);
    }

    /**
     * Ask Pesapal what became of an order, using a named credential set.
     */
    public function transactionStatusUsing(PesapalCredentials $credentials, string $trackingId): GatewayStatus
    {
        return $this->readStatus($credentials, $trackingId)['status'];
    }

    /**
     * Ask Pesapal what became of a RECURRING subscription transaction.
     *
     * The same GetTransactionStatus call, keeping one extra field:
     * `subscription_transaction_info.account_reference`, which is the
     * `account_number` set when the subscription was created -- the tenant id.
     *
     * THAT FIELD IS WHY THIS METHOD EXISTS. A recurring notification names no
     * clinic, and could not be believed if it did; Pesapal initiates months two
     * onward itself, so the tracking id in the notification is one this system
     * has never seen and cannot look up. The only trustworthy statement of which
     * clinic paid is this one, read back over an authenticated TLS connection
     * from the party that took the money.
     *
     * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
     */
    public function subscriptionStatusUsing(
        PesapalCredentials $credentials,
        string $trackingId,
    ): PesapalSubscriptionStatus {
        $read = $this->readStatus($credentials, $trackingId);

        $info = $read['body']['subscription_transaction_info'] ?? null;

        return new PesapalSubscriptionStatus(
            $read['status'],
            is_array($info) ? $this->nonEmptyString($info['account_reference'] ?? null) : null,
        );
    }

    // --- Shared plumbing ---------------------------------------------------

    /**
     * One GetTransactionStatus call, decoded once.
     *
     * Returns the mapped status alongside the scrubbed body, so the recurring
     * caller can reach one further field without a second round trip and without
     * a second decode -- a second decode being a second place the credential
     * scrub would have to be remembered.
     *
     * @return array{status: GatewayStatus, body: array<array-key, mixed>}
     */
    private function readStatus(PesapalCredentials $credentials, string $trackingId): array
    {
        $body = $this->decode($credentials, $this->send(
            $credentials,
            fn (PendingRequest $request, string $base): Response => $request->get(
                $base.'/api/Transactions/GetTransactionStatus',
                ['orderTrackingId' => $trackingId],
            ),
        ));

        $reported = PesapalStatus::toGatewayStatus($body);

        if ($reported === null) {
            // An unrecognised status_code, or none at all. NOT treated as
            // pending, not treated as anything: the caller backs off and asks
            // again, and a status Pesapal has not given us is one we do not
            // have. The asymmetry is the point -- guessing "succeeded" confirms
            // a booking nobody paid for.
            throw new AggregatorUnavailable('The aggregator response could not be read.');
        }

        return ['status' => $reported, 'body' => $body];
    }

    /**
     * The registered id for this URL, if Pesapal already has one.
     *
     * A failure to list is a failure to register, not a licence to create a
     * duplicate -- so this propagates rather than returning null on error.
     */
    private function findRegisteredIpn(PesapalCredentials $credentials, string $url): ?string
    {
        $body = $this->decode($credentials, $this->send(
            $credentials,
            fn (PendingRequest $request, string $base): Response => $request->get($base.'/api/URLSetup/GetIpnList'),
        ));

        // Pesapal answers with a bare array; some deployments wrap it. Both are
        // read, neither is required.
        $entries = is_array($body['data'] ?? null) ? $body['data'] : $body;

        foreach ($entries as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            if ($this->nonEmptyString($entry['url'] ?? null) === $url) {
                return $this->nonEmptyString($entry['ipn_id'] ?? null);
            }
        }

        return null;
    }

    /**
     * Perform one authenticated call and insist on a 2xx.
     *
     * @param  callable(PendingRequest, string): Response  $call
     */
    private function send(PesapalCredentials $credentials, callable $call): Response
    {
        $request = Http::withToken($this->tokenUsing($credentials))
            ->acceptJson()
            ->timeout(self::TIMEOUT_SECONDS);

        try {
            $response = $call($request, $this->baseUrl($credentials));
        } catch (Throwable $e) {
            // The original is deliberately NOT attached as `previous`. An HTTP
            // client exception carries the request, the request carries an
            // Authorization header, and that header is a merchant credential --
            // which would then be written to any log that renders the trace. The
            // class name is all that survives, and it is enough to tell a timeout
            // from a DNS failure.
            throw new AggregatorUnavailable('Could not reach the aggregator: '.class_basename($e));
        }

        if (! $response->successful()) {
            throw new AggregatorUnavailable('The aggregator answered with HTTP '.$response->status().'.');
        }

        return $response;
    }

    /**
     * Authenticate and return a bearer token.
     *
     * Deliberately does NOT go through send(): send() authenticates, and this
     * is the authentication. The credentials travel in the body rather than a
     * header, and neither is ever read back out of the request object.
     */
    private function requestToken(PesapalCredentials $credentials): string
    {
        if (! $credentials->isConfigured()) {
            // A half-configured pair fails at the aggregator hours later, on a
            // live collection, which is the failure this refuses early. The
            // sentence differs by merchant because the two have different owners
            // -- see PesapalCredentials::describeMissing().
            throw new AggregatorUnavailable($credentials->describeMissing());
        }

        try {
            $response = Http::acceptJson()
                ->timeout(self::TIMEOUT_SECONDS)
                ->post($this->baseUrl($credentials).'/api/Auth/RequestToken', [
                    'consumer_key' => $credentials->consumerKey,
                    'consumer_secret' => $credentials->consumerSecret,
                ]);
        } catch (Throwable $e) {
            throw new AggregatorUnavailable('Could not reach the aggregator: '.class_basename($e));
        }

        if (! $response->successful()) {
            throw new AggregatorUnavailable('The aggregator answered with HTTP '.$response->status().'.');
        }

        $body = $this->decode($credentials, $response);

        $token = $this->nonEmptyString($body['token'] ?? null);

        if ($token === null) {
            // Pesapal answers a bad credential with HTTP 200 and an error
            // object, so a 2xx is not proof of anything. Only the machine code
            // is surfaced: it is stable enough for an administrator to act on
            // and short enough that it cannot carry a key back out.
            throw new AggregatorUnavailable(
                'The aggregator refused the merchant\'s credentials'.$this->errorSuffix($body).'.'
            );
        }

        return $token;
    }

    /**
     * A cached token, or null when there is not a usable one.
     *
     * The two stores never see each other's keys. A clinic's token is filed
     * under its tenant by TenantCache; the platform's is filed under an explicit
     * global key, because the caller may be running with no tenant bound at all
     * and because filing Carevelo's credential under some clinic's prefix is
     * exactly the confusion this whole domain is separated to prevent.
     */
    private function readCachedToken(PesapalCredentials $credentials): ?string
    {
        $cached = $credentials->isPlatform
            ? $this->platformCache->get($this->platformCacheKey($credentials))
            : $this->cache->get('pesapal:token:'.$credentials->identity);

        return is_string($cached) && $cached !== '' ? $cached : null;
    }

    private function writeCachedToken(PesapalCredentials $credentials, string $token): void
    {
        if ($credentials->isPlatform) {
            $this->platformCache->put(
                $this->platformCacheKey($credentials),
                $token,
                self::TOKEN_TTL_SECONDS,
            );

            return;
        }

        $this->cache->put('pesapal:token:'.$credentials->identity, $token, self::TOKEN_TTL_SECONDS);
    }

    /**
     * `platform:` first, so the key cannot collide with TenantCache's `tenant:`
     * namespace no matter what a tenant id ever looks like.
     */
    private function platformCacheKey(PesapalCredentials $credentials): string
    {
        return 'platform:pesapal:token:'.$credentials->identity;
    }

    /**
     * Refuse a 200 that carries an error object.
     *
     * Pesapal reports application failures inside a successful HTTP response.
     * Reading past that would mean treating "we could not create your order" as
     * an order.
     *
     * @param  array<array-key, mixed>  $body
     */
    private function refuseOnError(array $body): void
    {
        $error = is_array($body['error'] ?? null) ? $body['error'] : null;

        if ($error === null || $this->nonEmptyString($error['code'] ?? null) === null) {
            return;
        }

        throw new AggregatorUnavailable('The aggregator refused the request'.$this->errorSuffix($body).'.');
    }

    /**
     * ` [invalid_consumer_key_or_secret_provided]`, or nothing.
     *
     * The code only, never the message. Pesapal's prose sometimes quotes the
     * consumer key back at you, and this string ends up in an API response and
     * in an administrator's support ticket. The body has already been scrubbed
     * of both credentials by decode(); using only the code means there is
     * nothing left to scrub even if that ever stopped working.
     *
     * @param  array<array-key, mixed>  $body
     */
    private function errorSuffix(array $body): string
    {
        $error = is_array($body['error'] ?? null) ? $body['error'] : [];

        $code = $this->nonEmptyString($error['code'] ?? null);

        return $code === null ? '' : " [{$code}]";
    }

    /**
     * Decode a response body, with the calling credentials removed from it.
     *
     * Every read of a Pesapal body goes through here. Doing the scrub once, at
     * the boundary, is what makes "a credential never reaches a log, a response
     * or an audit event" a property of the code rather than a rule each caller
     * has to remember -- and it is why the platform's credentials are as safe
     * here as a clinic's, without a second implementation to keep in step.
     *
     * @return array<array-key, mixed>
     */
    private function decode(PesapalCredentials $credentials, Response $response): array
    {
        $body = $response->json();

        if (! is_array($body)) {
            throw new AggregatorUnavailable('The aggregator response could not be read.');
        }

        return $this->scrub($body, $credentials->secrets());
    }

    /**
     * @param  array<array-key, mixed>  $body
     * @param  list<string>  $secrets
     * @return array<array-key, mixed>
     */
    private function scrub(array $body, array $secrets): array
    {
        if ($secrets === []) {
            return $body;
        }

        $scrubbed = [];

        foreach ($body as $key => $value) {
            if (is_array($value)) {
                $scrubbed[$key] = $this->scrub($value, $secrets);

                continue;
            }

            $scrubbed[$key] = is_string($value)
                ? str_replace($secrets, '[redacted]', $value)
                : $value;
        }

        return $scrubbed;
    }

    /**
     * Whether this is a URL we are willing to send a browser to.
     *
     * Host-matched against the environment's own base URL rather than a
     * substring test: `https://pay.pesapal.com.evil.example` contains
     * `pay.pesapal.com` and is not Pesapal.
     */
    private function isPesapalUrl(string $url, PesapalCredentials $credentials): bool
    {
        $host = parse_url($url, PHP_URL_HOST);
        $expected = parse_url($this->baseUrl($credentials), PHP_URL_HOST);

        return parse_url($url, PHP_URL_SCHEME) === 'https'
            && is_string($host)
            && $host === $expected;
    }

    /**
     * Sandbox or live, from the credentials themselves.
     *
     * For a clinic that means its OWN account row, never configuration: a
     * platform-wide switch would put one clinic's live collection through the
     * sandbox, or the reverse, on a deployment that looked entirely healthy. For
     * the platform there is exactly one merchant, so configuration IS the row.
     */
    private function baseUrl(PesapalCredentials $credentials): string
    {
        return $credentials->environment === 'live'
            ? self::LIVE_BASE_URL
            : self::SANDBOX_BASE_URL;
    }

    private function nonEmptyString(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
