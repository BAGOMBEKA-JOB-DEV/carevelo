<?php

namespace App\Policies;

use App\Models\BreakGlassGrant;
use App\Models\ClinicalRole;
use App\Models\User;

/**
 * Who may request and read break-glass grants.
 *
 * Requesting one is not the same as using one. This policy governs the CONTROL
 * SURFACE — asking for access, and reading the register of who asked. Whether a
 * granted operator may then touch a given record is decided by the grant itself
 * and audited on every access (App\Services\Platform\BreakGlassAccess).
 *
 * Note who else can read a grant: the clinic it names. The controller has a
 * right to know when its processor read its records, so a clinic_admin sees the
 * grants against their own tenant and nobody else's.
 *
 * @see docs/50-security-compliance/rbac-matrix.md break-glass section
 */
class BreakGlassGrantPolicy
{
    use HandlesTenantAuthorisation;

    public function viewAny(User $user): bool
    {
        return $this->isPlatformOperator($user)
            || $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    public function view(User $user, BreakGlassGrant $grant): bool
    {
        if ($this->isPlatformOperator($user)) {
            return true;
        }

        return $this->sameTenant($user, $grant->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    /**
     * Request a grant.
     *
     * Both platform roles may, because the alternative is worse: support staff
     * without a legitimate route to a record improvise one, and an improvised
     * route is unaudited by definition. A rising grant count means the
     * metadata-based support tooling is inadequate — the response is to build
     * better tooling, never to make this easier.
     */
    public function create(User $user): bool
    {
        return $this->isPlatformOperator($user);
    }

    /**
     * A grant is fixed once issued.
     *
     * No widening a scope, no extending a time box. Both are new grants, each
     * notified to the clinic and audited again.
     */
    public function update(User $user, BreakGlassGrant $grant): bool
    {
        return false;
    }

    /** Nothing is deleted. The grant register is the evidence the control worked. */
    public function delete(User $user, BreakGlassGrant $grant): bool
    {
        return false;
    }

    /**
     * A platform role held by a user belonging to no clinic.
     *
     * The isPlatformUser() half matters as much as the role: a tenant user who
     * somehow acquired a platform role must not gain cross-tenant reach from it.
     */
    protected function isPlatformOperator(User $user): bool
    {
        return $user->isPlatformUser() && $this->hasAnyRole($user, [
            ClinicalRole::PlatformSupport,
            ClinicalRole::PlatformAdmin,
        ]);
    }
}
