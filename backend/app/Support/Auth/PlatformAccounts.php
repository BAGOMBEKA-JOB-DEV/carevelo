<?php

namespace App\Support\Auth;

use App\Models\ClinicalRole;
use App\Models\User;

/**
 * Finds the Carevelo account an email address belongs to.
 *
 * The counterpart to Accounts, and the difference is the whole reason both
 * exist. Accounts scopes every lookup to the resolved tenant, because an address
 * registered at another clinic is not registered here. There is no tenant to
 * scope to on this surface: a platform account has `tenant_id = null` by
 * definition -- that is what makes it a platform account -- and the sign-in route
 * runs outside ResolveTenant entirely.
 *
 * So the scoping predicate here is `tenant_id is null`, and it is not optional.
 * Without it this query would find a clinic's staff account with the same
 * address and authenticate it into the cross-tenant control plane, which is the
 * single worst outcome available on this endpoint.
 *
 * A PLATFORM ROLE IS REQUIRED AS WELL. `tenant_id is null` says the account
 * belongs to no clinic; it does not say the account is anybody in particular. A
 * row that lost its tenant through a bug, a botched import or a half-finished
 * offboarding would otherwise satisfy the first condition and nothing else, and
 * would be signing in to a surface that provisions and suspends clinics.
 *
 * `break_glass` is deliberately NOT on the list. It is granted temporarily by a
 * grant and confers clinical read inside a tenant's own surfaces; it is not a
 * standing identity and must never be a way in.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class PlatformAccounts
{
    /**
     * The active platform account for this address, if there is one.
     *
     * Deactivated accounts return null and therefore fail exactly as an unknown
     * address does. A distinct "your account is disabled" would confirm the
     * account exists to whoever now has the mailbox.
     */
    public function activeFor(string $email): ?User
    {
        $user = User::query()
            ->whereNull('tenant_id')
            ->whereRaw('lower(email) = ?', [mb_strtolower($email)])
            ->where('is_active', true)
            ->first();

        if ($user === null) {
            return null;
        }

        // Checked in PHP rather than as a `whereHas` on the query, so that "no
        // such account" and "an account with no platform role" return the same
        // null through the same path. The caller compares the password against a
        // decoy digest on that path, which is what keeps the two indistinguishable
        // in timing as well as in the response.
        return $this->holdsPlatformRole($user) ? $user : null;
    }

    /**
     * The active platform account with this id, if there still is one.
     *
     * ============================================================
     * WHY THE CODE STEP RE-CHECKS EVERYTHING THE PASSWORD STEP CHECKED
     * ============================================================
     *
     * A platform sign-in is two requests with up to five minutes between them
     * (SecondFactorSession::PENDING_TTL_SECONDS), and the only thing carried
     * across is an ACCOUNT ID in the session. Five minutes is long enough for
     * the account to be deactivated or to lose its platform role -- which are
     * precisely the two things somebody does in a hurry when they have just
     * realised a credential is compromised. Loading the row by id and signing it
     * in would honour a password proved against an account that no longer
     * exists in any meaningful sense, at the exact moment somebody was trying to
     * revoke it.
     *
     * So this applies the same three predicates activeFor() does -- no tenant, a
     * standing platform role, still active -- and the challenge endpoint treats
     * a null here exactly as it treats an expired challenge. Reusing the private
     * role check keeps the two from drifting: the day `break_glass` or a third
     * platform role changes what "a platform account" means, it changes once.
     */
    public function activeById(string $id): ?User
    {
        $user = User::query()
            ->whereKey($id)
            ->whereNull('tenant_id')
            ->where('is_active', true)
            ->first();

        if ($user === null) {
            return null;
        }

        return $this->holdsPlatformRole($user) ? $user : null;
    }

    /**
     * `tenant_id is null` says the account belongs to no clinic; it does not say
     * the account is anybody in particular. See the class docblock for why a row
     * that lost its tenant through a bug or a half-finished offboarding must not
     * satisfy that on its own, and for why `break_glass` is not on this list.
     */
    private function holdsPlatformRole(User $user): bool
    {
        return $user->hasAnyRole([
            ClinicalRole::PlatformSupport->value,
            ClinicalRole::PlatformAdmin->value,
        ]);
    }
}
