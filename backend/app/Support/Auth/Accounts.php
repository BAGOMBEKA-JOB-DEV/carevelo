<?php

namespace App\Support\Auth;

use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Tenancy\TenantContext;

/**
 * Finds the account a phone number belongs to, within this clinic.
 *
 * Uniqueness is (tenant_id, phone), so the same person at two clinics is two
 * accounts. That follows directly from tenant isolation and is why the lookup
 * here is always scoped: a number registered next door is not registered here.
 *
 * User is deliberately not tenant-scoped by global scope -- authentication has
 * to find the account before a session exists to resolve a tenant from -- so
 * this class supplies the scoping that the model does not.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class Accounts
{
    public function __construct(protected TenantContext $context) {}

    /**
     * The active account for this number at this clinic, if there is one.
     *
     * Deactivated accounts return null and therefore fail exactly as an unknown
     * number does. A distinct "your account is disabled" response would confirm
     * the account exists to whoever now holds the handset.
     */
    public function activeFor(string $e164): ?User
    {
        return User::query()
            ->where('tenant_id', $this->context->currentOrFail())
            ->where('phone', $e164)
            ->where('is_active', true)
            ->first();
    }

    /**
     * The active account for this EMAIL at this clinic, if there is one.
     *
     * Scoped by tenant for the same reason activeFor() is: an address registered at
     * another clinic is not registered here. Uniqueness is (tenant_id, email) — it was
     * global until email sign-in was built, which would have let one clinic's address
     * block another's.
     *
     * Deactivated accounts return null and therefore fail exactly as an unknown address
     * does. A distinct "your account is disabled" would confirm the account exists to
     * whoever now has the mailbox.
     */
    public function activeForEmail(string $email): ?User
    {
        return User::query()
            ->where('tenant_id', $this->context->currentOrFail())
            ->whereRaw('lower(email) = ?', [mb_strtolower($email)])
            ->where('is_active', true)
            ->first();
    }

    /**
     * Whether this account may open a session right now.
     *
     * Suspension is a COMMERCIAL action and must never become a clinical one. It
     * stops the clinic's staff working -- that is the point of it -- but a
     * patient must still reach their own records, and a delivery already in
     * flight must still complete. So the block is by role, not by tenant.
     */
    public function mayStartSession(User $user): bool
    {
        $tenant = Tenant::query()->find($this->context->currentOrFail());

        if ($tenant?->status !== TenantStatus::Suspended) {
            return true;
        }

        return $user->hasRole(ClinicalRole::Patient->value);
    }
}
