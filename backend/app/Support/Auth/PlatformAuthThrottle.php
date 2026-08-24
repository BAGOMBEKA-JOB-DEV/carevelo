<?php

namespace App\Support\Auth;

use Illuminate\Cache\RateLimiter;

/**
 * Rate limits on the platform sign-in and the code challenge.
 *
 * ============================================================
 * WHY THIS IS NOT AuthThrottle
 * ============================================================
 *
 * AuthThrottle namespaces every bucket by the resolved tenant, through
 * `TenantContext::currentOrFail()` -- which throws when no tenant is bound, and
 * no tenant is ever bound on these routes. That is not a limitation to work
 * around: it is the tenant-scoping presumption doing its job, refusing to build a
 * key that would be shared across clinics. A platform sign-in genuinely has no
 * tenant, so it gets its own keys, in their own namespace, and the two classes
 * cannot quietly share a bucket.
 *
 * ============================================================
 * THE CODE CHALLENGE NEEDS A TIGHTER LIMIT THAN THE PASSWORD
 * ============================================================
 *
 * A six-digit code is one in a million, and one in a million is not a lot when
 * the attacker already has the password and can post codes in a loop. At ten
 * guesses per fifteen minutes against a ninety-second window, the expected time
 * to a hit is measured in centuries; at the ten thousand per hour an unlimited
 * endpoint permits, it is measured in months. The limit IS the strength of the
 * second factor here, which is why the two numbers below are different and why
 * the code one is the smaller.
 *
 * COUNTED BEFORE ANY LOOKUP, like AuthThrottle, so being over the limit is
 * indistinguishable between a registered and an unregistered identifier.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class PlatformAuthThrottle
{
    /** Password guesses per identifier. */
    public const ATTEMPTS_PER_IDENTIFIER = 10;

    public const ATTEMPTS_PER_IP = 30;

    /** Code guesses. Deliberately the smallest number on this page -- see above. */
    public const CHALLENGE_ATTEMPTS = 10;

    /** Fifteen minutes, matching the tenant limiter so the two cannot drift. */
    public const DECAY_SECONDS = 900;

    public function __construct(protected RateLimiter $limiter) {}

    /** @return ?int seconds to wait, or null when the request may proceed */
    public function signIn(string $identifier, ?string $ipAddress): ?int
    {
        return $this->guard([
            $this->key('sign-in', 'identifier', hash('sha256', $identifier)) => self::ATTEMPTS_PER_IDENTIFIER,
            $this->key('sign-in', 'ip', $ipAddress ?? 'unknown') => self::ATTEMPTS_PER_IP,
        ]);
    }

    /**
     * @return ?int seconds to wait, or null when the request may proceed
     */
    public function challenge(string $userId, ?string $ipAddress): ?int
    {
        return $this->guard([
            $this->key('challenge', 'account', $userId) => self::CHALLENGE_ATTEMPTS,
            $this->key('challenge', 'ip', $ipAddress ?? 'unknown') => self::ATTEMPTS_PER_IP,
        ]);
    }

    /**
     * Forget the challenge budget for an account that has just succeeded.
     *
     * Without this, an operator who fumbles a code twice, succeeds, signs out and
     * signs back in an hour later is still carrying two of their ten guesses. The
     * budget exists to bound GUESSING, and a completed challenge is proof that no
     * guessing happened.
     */
    public function clearChallenge(string $userId, ?string $ipAddress): void
    {
        $this->limiter->clear($this->key('challenge', 'account', $userId));
        $this->limiter->clear($this->key('challenge', 'ip', $ipAddress ?? 'unknown'));
    }

    /**
     * @param  array<string, int>  $buckets  key => permitted attempts
     * @return ?int seconds to wait, or null when the request may proceed
     */
    protected function guard(array $buckets): ?int
    {
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
     * No tenant prefix, because there is no tenant -- and the identifier arrives
     * already digested for the same reason AuthThrottle digests it: a cache store
     * is a disclosure surface of its own, and keys turn up in Redis dumps and in
     * screenshots.
     */
    protected function key(string $action, string $dimension, string $value): string
    {
        return sprintf('platform:auth:%s:%s:%s', $action, $dimension, $value);
    }
}
