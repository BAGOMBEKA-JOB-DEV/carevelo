<?php

namespace App\Services\Payments\Pesapal;

use App\Models\AggregatorAccount;

/**
 * One set of Pesapal credentials, and whose they are.
 *
 * WHY THIS TYPE EXISTS. PesapalClient used to take an AggregatorAccount
 * everywhere, which made it structurally incapable of speaking for anyone but a
 * clinic -- an AggregatorAccount carries a tenant_id and lives under row-level
 * security, so there is no such row for Carevelo and there must not be one.
 * Subscription billing needs the same HTTP behaviour with a different merchant
 * behind it, and the two honest options were a second client or a narrower
 * argument. A second client would be a second place the 5-minute token, the
 * credential scrub and the "an unreadable answer is an error" rule live, and
 * the copy would drift; the first thing to rot would be the scrub.
 *
 * So the client now speaks in credentials, and this type is the only thing that
 * knows how to build a set. It is a deliberately thin seam, and the two factory
 * methods are the whole of it:
 *
 *   forAccount()  -- A CLINIC'S OWN merchant account, read from its encrypted
 *                    aggregator_accounts row. Collects a PATIENT'S payment,
 *                    which settles to the clinic.
 *
 *   forPlatform() -- CAREVELO'S OWN merchant account, read from config/env.
 *                    Collects a CLINIC'S subscription to the software, which is
 *                    our own revenue and the only revenue ADR-0003 allows.
 *
 * There is no third, and there is no path from one to the other. forPlatform()
 * cannot be reached from an AggregatorAccount and forAccount() cannot be
 * reached from configuration, so a caller holding a clinic's row cannot
 * accidentally authenticate as the platform or the reverse.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
final readonly class PesapalCredentials
{
    private function __construct(
        /**
         * What distinguishes this credential set in the token cache.
         *
         * Never the secret itself and never the consumer key: a cache entry is
         * readable by anything sharing the store, and a key is a place people do
         * not think to look for a credential.
         */
        public string $identity,

        /** Whose money these collect. Decides where the token may be cached. */
        public bool $isPlatform,

        public ?string $consumerKey,
        public ?string $consumerSecret,

        /** `live` or anything else, which means sandbox. */
        public string $environment,
    ) {}

    /**
     * A clinic's own credentials.
     *
     * Pesapal's consumer key lives in `public_key` and its consumer secret in
     * `secret_key`, which is the mapping the account row has always used. Both
     * may be null on a half-configured account; the client refuses at the point
     * of authenticating rather than here, so that behaviour is unchanged and a
     * cached token still short-circuits.
     *
     * The environment comes from the ROW, never from configuration. A
     * platform-wide switch would put one clinic's live collection through the
     * sandbox, or the reverse, on a deployment that looked entirely healthy.
     */
    public static function forAccount(AggregatorAccount $account): self
    {
        return new self(
            identity: $account->id,
            isPlatform: false,
            consumerKey: self::nonEmpty($account->getAttribute('public_key')),
            consumerSecret: self::nonEmpty($account->secret_key),
            environment: is_string($account->getAttribute('environment'))
                ? (string) $account->getAttribute('environment')
                : 'sandbox',
        );
    }

    /**
     * Carevelo's own credentials, for its own subscription revenue.
     *
     * The identity is a TRUNCATED HASH of the consumer key rather than the key
     * itself. It has to change when the credentials are rotated -- otherwise a
     * token minted from the old pair is served for four minutes after the
     * rotation, which is a 401 on a real collection -- and it must not be the
     * credential, because it lands in a cache key.
     *
     * @param  array{consumer_key?: ?string, consumer_secret?: ?string, environment?: ?string}  $config
     */
    public static function forPlatform(array $config): self
    {
        $key = self::nonEmpty($config['consumer_key'] ?? null);

        return new self(
            // A constant when unconfigured, which is the ordinary state on a
            // developer machine. Nothing is cached against it, because
            // authentication fails before a token exists.
            identity: $key === null ? 'unconfigured' : substr(hash('sha256', $key), 0, 16),
            isPlatform: true,
            consumerKey: $key,
            consumerSecret: self::nonEmpty($config['consumer_secret'] ?? null),
            environment: self::nonEmpty($config['environment'] ?? null) ?? 'sandbox',
        );
    }

    public function isConfigured(): bool
    {
        return $this->consumerKey !== null && $this->consumerSecret !== null;
    }

    /**
     * The strings that must never survive into a decoded response body.
     *
     * @return list<string>
     */
    public function secrets(): array
    {
        return array_values(array_filter([$this->consumerKey, $this->consumerSecret]));
    }

    /**
     * What to say when there is nothing to authenticate with.
     *
     * Two sentences rather than one, because the two failures have different
     * owners. A clinic's missing credentials are the clinic administrator's to
     * fix from the console; the platform's are an operator's to fix in the
     * environment, and telling a clinic administrator about our configuration
     * would be both confusing and a small disclosure.
     */
    public function describeMissing(): string
    {
        return $this->isPlatform
            ? 'The platform has no usable subscription billing credentials configured.'
            : 'The clinic has no usable aggregator credentials configured.';
    }

    private static function nonEmpty(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
