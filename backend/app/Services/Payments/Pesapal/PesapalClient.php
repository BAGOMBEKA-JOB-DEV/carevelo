<?php

namespace App\Services\Payments\Pesapal;

use App\Models\AggregatorAccount;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\CollectionHandoff;
use App\Services\Payments\GatewayStatus;
use App\Support\TenantCache;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * The HTTP half of Pesapal, which holds a Bank of Uganda Payment System
 * Operator licence.
 *
 * The licensed party is the aggregator; the merchant is THE CLINIC; Carevelo is
 * the software that calls their API on the clinic's behalf, with the clinic's
 * own consumer key and secret. Funds move patient -> Pesapal -> clinic and
 * never touch an account we own, because no such account exists.
 *
 * Everything here is either an authentication, a read, or an instruction to
 * Pesapal that a collection is expected. None of it moves money and none of it
 * could: the merchant account named by these credentials belongs to the clinic.
 *
 * THREE RULES THIS CLASS EXISTS TO KEEP.
 *
 * 1. The bearer token and the consumer secret never leave this class. They are
 *    not logged, not audited, not put in an exception message, and not returned
 *    to any caller. AggregatorUnavailable is thrown WITHOUT a `previous`,
 *    because an HTTP client exception carries the request, the request carries
 *    the Authorization header, and that header is a clinic's credential.
 *
 * 2. Every response body is scrubbed of this account's credentials before
 *    anything reads it. Pesapal echoes the consumer key in some error messages,
 *    and those messages are surfaced to the administrator verbatim -- so the
 *    scrub happens at the point of decoding rather than at each of the places
 *    text is later used, where one omission would be enough.
 *
 * 3. An unreadable answer is an error, never a guess. A malformed body raises
 *    AggregatorUnavailable so the caller backs off and asks again; inventing a
 *    status here would confirm a booking nobody paid for.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
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

    public function __construct(private readonly TenantCache $cache) {}

    /**
     * A bearer token for this clinic's own merchant account.
     *
     * Cached per ACCOUNT, not per tenant and not globally. TenantCache prefixes
     * the key with the tenant, so a key built here cannot be read by another
     * tenant even by accident; the account id in the key means a clinic that
     * rotates its credentials, or holds accounts at two aggregators, cannot be
     * handed a token minted from the other set.
     *
     * The token is a secret at rest in the cache for four minutes. That is the
     * whole of its life and it is the price of not authenticating on every
     * call; nothing else about it is written down anywhere.
     */
    public function token(AggregatorAccount $account): string
    {
        $key = 'pesapal:token:'.$account->id;

        $cached = $this->cache->get($key);

        // Read-then-write rather than remember(), so that an entry which is not
        // a usable token -- a mis-serialised value, a poisoned shared cache --
        // is DISCARDED rather than sent as an Authorization header. remember()
        // would hand it straight back.
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $token = $this->requestToken($account);

        $this->cache->put($key, $token, self::TOKEN_TTL_SECONDS);

        return $token;
    }

    /**
     * Prove the clinic's credentials without moving anything.
     *
     * This is the whole of what verification needs: Pesapal either issues a
     * token for these credentials or it does not. No order is submitted, no
     * collection is attempted, nobody is charged a shilling to prove a
     * configuration -- and there would be no platform account for that shilling
     * to land in if they were.
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
        $existing = $this->findRegisteredIpn($account, $url);

        if ($existing !== null) {
            return $existing;
        }

        $body = $this->decode($account, $this->send(
            $account,
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
        $body = $this->decode($account, $this->send(
            $account,
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

        // A redirect URL is where a PATIENT'S BROWSER is sent. Accepting an
        // arbitrary string here would make a compromised or mistaken response
        // into an open redirect with a clinic's name on it, so only an https
        // URL on Pesapal's own host is honoured.
        if (! $this->isPesapalUrl($redirectUrl, $account)) {
            throw new AggregatorUnavailable('The aggregator returned a payment page we will not send a patient to.');
        }

        return CollectionHandoff::to($trackingId, $redirectUrl);
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
        $body = $this->decode($account, $this->send(
            $account,
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

        return $reported;
    }

    /**
     * The registered id for this URL, if Pesapal already has one.
     *
     * A failure to list is a failure to register, not a licence to create a
     * duplicate -- so this propagates rather than returning null on error.
     */
    private function findRegisteredIpn(AggregatorAccount $account, string $url): ?string
    {
        $body = $this->decode($account, $this->send(
            $account,
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
    private function send(AggregatorAccount $account, callable $call): Response
    {
        $request = Http::withToken($this->token($account))
            ->acceptJson()
            ->timeout(self::TIMEOUT_SECONDS);

        try {
            $response = $call($request, $this->baseUrl($account));
        } catch (Throwable $e) {
            // The original is deliberately NOT attached as `previous`. An HTTP
            // client exception carries the request, the request carries an
            // Authorization header, and that header is a clinic's merchant
            // credential -- which would then be written to any log that renders
            // the trace. The class name is all that survives, and it is enough
            // to tell a timeout from a DNS failure.
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
    private function requestToken(AggregatorAccount $account): string
    {
        $consumerKey = $this->nonEmptyString($account->getAttribute('public_key'));
        $consumerSecret = $this->nonEmptyString($account->secret_key);

        if ($consumerKey === null || $consumerSecret === null) {
            // Pesapal's consumer key lives in public_key and its consumer secret
            // in secret_key. Both are required; a half-configured pair fails at
            // the aggregator hours later, on a live collection, which is the
            // failure this refuses early.
            throw new AggregatorUnavailable('The clinic has no usable aggregator credentials configured.');
        }

        try {
            $response = Http::acceptJson()
                ->timeout(self::TIMEOUT_SECONDS)
                ->post($this->baseUrl($account).'/api/Auth/RequestToken', [
                    'consumer_key' => $consumerKey,
                    'consumer_secret' => $consumerSecret,
                ]);
        } catch (Throwable $e) {
            throw new AggregatorUnavailable('Could not reach the aggregator: '.class_basename($e));
        }

        if (! $response->successful()) {
            throw new AggregatorUnavailable('The aggregator answered with HTTP '.$response->status().'.');
        }

        $body = $this->decode($account, $response);

        $token = $this->nonEmptyString($body['token'] ?? null);

        if ($token === null) {
            // Pesapal answers a bad credential with HTTP 200 and an error
            // object, so a 2xx is not proof of anything. Only the machine code
            // is surfaced: it is stable enough for an administrator to act on
            // and short enough that it cannot carry a key back out.
            throw new AggregatorUnavailable(
                'The aggregator refused the clinic\'s credentials'.$this->errorSuffix($body).'.'
            );
        }

        return $token;
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
     * Decode a response body, with this account's credentials removed from it.
     *
     * Every read of a Pesapal body goes through here. Doing the scrub once, at
     * the boundary, is what makes "a credential never reaches a log, a response
     * or an audit event" a property of the code rather than a rule each caller
     * has to remember.
     *
     * @return array<array-key, mixed>
     */
    private function decode(AggregatorAccount $account, Response $response): array
    {
        $body = $response->json();

        if (! is_array($body)) {
            throw new AggregatorUnavailable('The aggregator response could not be read.');
        }

        return $this->scrub($body, array_values(array_filter([
            $this->nonEmptyString($account->getAttribute('public_key')),
            $this->nonEmptyString($account->secret_key),
        ])));
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
     * Whether this is a URL we are willing to send a patient's browser to.
     *
     * Host-matched against the environment's own base URL rather than a
     * substring test: `https://pay.pesapal.com.evil.example` contains
     * `pay.pesapal.com` and is not Pesapal.
     */
    private function isPesapalUrl(string $url, AggregatorAccount $account): bool
    {
        $host = parse_url($url, PHP_URL_HOST);
        $expected = parse_url($this->baseUrl($account), PHP_URL_HOST);

        return parse_url($url, PHP_URL_SCHEME) === 'https'
            && is_string($host)
            && $host === $expected;
    }

    /**
     * Sandbox or live, from the CLINIC'S OWN account row.
     *
     * Never from configuration. A platform-wide switch would put one clinic's
     * live collection through the sandbox, or the reverse, on a deployment that
     * looked entirely healthy.
     */
    private function baseUrl(AggregatorAccount $account): string
    {
        return $account->getAttribute('environment') === 'live'
            ? self::LIVE_BASE_URL
            : self::SANDBOX_BASE_URL;
    }

    private function nonEmptyString(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
