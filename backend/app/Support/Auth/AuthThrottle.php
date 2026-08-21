<?php

namespace App\Support\Auth;

use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiter;

/**
 * Rate limits on the public authentication endpoint.
 *
 * PER NUMBER AND PER ADDRESS, both, because each alone is trivially defeated. A
 * per-number limit does not slow an attacker walking a list of numbers from one
 * host; a per-address limit does not slow a botnet grinding one number. The two
 * together bound both shapes of abuse.
 *
 * Counted BEFORE any lookup, so being over the limit is indistinguishable
 * between a registered and an unregistered number -- a throttle that only
 * engaged for real accounts would answer the question the endpoint exists to
 * refuse to answer.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class AuthThrottle
{
    /**
     * Guesses. Generous enough that a member of staff misremembering their own
     * password is not locked out of a clinic's day, and far short of what a
     * dictionary attack needs.
     */
    public const ATTEMPTS_PER_PHONE = 10;

    public const ATTEMPTS_PER_IP = 30;

    /** Fifteen minutes. Long enough to be a real cost, short enough to forgive a bad afternoon. */
    public const DECAY_SECONDS = 900;

    public function __construct(
        protected RateLimiter $limiter,
        protected TenantContext $context,
    ) {}

    /** @return ?int seconds to wait, or null when the request may proceed */
    public function passwordSignIn(string $e164, ?string $ipAddress): ?int
    {
        return $this->guard('sign-in', $e164, $ipAddress, self::ATTEMPTS_PER_PHONE, self::ATTEMPTS_PER_IP);
    }

    /**
     * @return ?int seconds to wait, or null when the request may proceed
     */
    protected function guard(string $action, string $e164, ?string $ipAddress, int $perPhone, int $perIp): ?int
    {
        $buckets = [
            $this->key($action, 'phone', hash('sha256', $e164)) => $perPhone,
            $this->key($action, 'ip', $ipAddress ?? 'unknown') => $perIp,
        ];

        foreach ($buckets as $key => $limit) {
            if ($this->limiter->tooManyAttempts($key, $limit)) {
                return $this->limiter->availableIn($key);
            }
        }

        foreach (array_keys($buckets) as $key) {
            $this->limiter->hit($key, self::DECAY_SECONDS);
        }

        return null;
    }

    /**
     * Tenant-namespaced, like every other key in this system.
     *
     * The phone arrives already digested. A cache store is a disclosure surface
     * of its own -- keys turn up in Redis dumps, in slow-query tooling and in
     * screenshots -- and "this number authenticated at this clinic" is exactly
     * the fact the endpoint above is protecting.
     */
    protected function key(string $action, string $dimension, string $value): string
    {
        return sprintf(
            'tenant:%s:auth:%s:%s:%s',
            $this->context->currentOrFail(),
            $action,
            $dimension,
            $value,
        );
    }
}
