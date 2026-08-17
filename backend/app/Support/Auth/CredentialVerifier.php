<?php

namespace App\Support\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Password comparison that costs the same whether or not the account exists.
 *
 * Skipping the hash comparison when no user was found is the classic
 * enumeration leak: the unregistered branch returns in a millisecond and the
 * registered branch takes a hundred, so an attacker with a stopwatch learns
 * which numbers belong to patients of this clinic. In a health application that
 * is a disclosure of special-category data, not a performance detail.
 *
 * So every path through this class performs exactly one bcrypt comparison.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
final class CredentialVerifier
{
    /**
     * A real bcrypt digest of a value nobody knows, at cost 12.
     *
     * Hardcoded rather than generated per process: generating it would itself
     * cost a hash, so the not-found branch would do two units of work where the
     * found branch does one -- reintroducing exactly the timing difference this
     * class removes. The cost is pinned to 12 because bcrypt stores its cost in
     * the digest, and 12 is the application's configured production cost.
     */
    private const DECOY = '$2y$12$gW01tyaKW0rhou7gCt6L4Ob3i1z9YxNM1oAxPN.Rd9SGlSA8/K3N6';

    /**
     * Whether the password belongs to this user.
     *
     * A null user is a number that is not registered here. It is compared
     * against the decoy anyway, and returns false -- the same false, after the
     * same work, as a registered number with the wrong password.
     */
    public function matches(?User $user, string $password): bool
    {
        $hash = $user?->getAuthPassword();

        if (! is_string($hash) || $hash === '') {
            $this->decoy($password);

            return false;
        }

        return Hash::check($password, $hash);
    }

    /**
     * Burn one comparison's worth of work and learn nothing.
     *
     * Called on any branch that would otherwise return early: an unregistered
     * number at OTP request time, or a verification with fewer stored codes
     * than the comparison budget.
     */
    public function decoy(string $candidate): void
    {
        Hash::check($candidate, self::DECOY);
    }
}
