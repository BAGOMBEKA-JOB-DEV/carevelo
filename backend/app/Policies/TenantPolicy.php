<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;

/**
 * Who may act on the tenant register.
 *
 * Note what is absent, and note it in both directions.
 *
 * There is no clinical ability here at all: platform_support and platform_admin
 * reach the register, the subscription state and system health, and nothing
 * whatsoever behind it. Every clinical policy in app/Policies denies them
 * through sameTenant(), which a platform user can never satisfy — a platform
 * user has no tenant_id, by design.
 *
 * There is also no delete. The register entry survives offboarding: it is the
 * proof that the export and deletion obligations were discharged.
 *
 * @see docs/50-security-compliance/rbac-matrix.md administration table
 */
class TenantPolicy
{
    use HandlesTenantAuthorisation;

    /**
     * Read the register.
     *
     * Support reads it to answer "is this clinic provisioned, on trial,
     * suspended?" — the questions that are answerable from metadata, which is
     * the only kind of question ordinary support tooling should need to ask.
     */
    public function viewAny(User $user): bool
    {
        return $this->hasAnyPlatformRole($user, [
            ClinicalRole::PlatformSupport,
            ClinicalRole::PlatformAdmin,
        ]);
    }

    /** Provisioning is platform_admin's alone. Support does not create clinics. */
    public function create(User $user): bool
    {
        return $this->hasAnyPlatformRole($user, [ClinicalRole::PlatformAdmin]);
    }

    /**
     * Suspension and offboarding.
     *
     * A COMMERCIAL action, never a clinical one. Nothing here reaches a record;
     * it moves the tenant's lifecycle state, and TenantStatus decides which
     * moves are legal.
     */
    public function update(User $user, Tenant $tenant): bool
    {
        return $this->hasAnyPlatformRole($user, [ClinicalRole::PlatformAdmin]);
    }

    /**
     * The offboarding export.
     *
     * A controller obligation we enable, not a courtesy. The clinic's own
     * administrator may take it, and platform_admin may take it on the clinic's
     * behalf — the second exists so that a clinic locked out of its own console
     * still leaves with its data.
     *
     * Deliberately NOT conditioned on the tenant's status. A clinic in a
     * commercial dispute is precisely the clinic whose export someone will be
     * tempted to withhold, and withholding it would be unlawful and would harm
     * patients.
     */
    public function export(User $user, Tenant $tenant): bool
    {
        if ($this->hasAnyPlatformRole($user, [ClinicalRole::PlatformAdmin])) {
            return true;
        }

        return $this->sameTenant($user, $tenant->id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    /** Platform health: reachability and counts. No tenant's data is involved. */
    public function viewHealth(User $user): bool
    {
        return $this->viewAny($user);
    }

    /**
     * Nobody deletes a tenant.
     *
     * Offboarding deletes the tenant's DATA and closes the tenant; the register
     * row and the audit trail of the deletion are retained deliberately.
     */
    public function delete(User $user, Tenant $tenant): bool
    {
        return false;
    }

    /**
     * A platform role held by a user who belongs to no clinic.
     *
     * Both halves matter. A tenant user who somehow acquired a platform role
     * must not gain cross-tenant reach from it, and hasAnyRole() alone would
     * grant exactly that.
     *
     * @param  list<ClinicalRole>  $roles
     */
    protected function hasAnyPlatformRole(User $user, array $roles): bool
    {
        return $user->isPlatformUser() && $this->hasAnyRole($user, $roles);
    }
}
