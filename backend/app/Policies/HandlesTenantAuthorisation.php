<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\User;

/**
 * Shared tenant and role checks for policies.
 *
 * These sit ABOVE row-level security, not instead of it. RLS already makes
 * another tenant's rows invisible; these checks produce a clear authorisation
 * answer and enforce the intra-tenant rules the database cannot express --
 * "only a clinician approves a substitution" is not something a row policy can
 * say.
 */
trait HandlesTenantAuthorisation
{
    /**
     * Whether the user belongs to the tenant owning the record.
     *
     * Platform users deliberately fail this. They reach no clinical data
     * without an audited break-glass grant.
     */
    protected function sameTenant(User $user, ?string $tenantId): bool
    {
        return $tenantId !== null
            && $user->tenant_id !== null
            && $user->tenant_id === $tenantId;
    }

    /**
     * @param  list<ClinicalRole>  $roles
     */
    protected function hasAnyRole(User $user, array $roles): bool
    {
        if (! $user->is_active) {
            return false;
        }

        return $user->hasAnyRole(array_map(fn (ClinicalRole $r) => $r->value, $roles));
    }

    /**
     * Whether this user is the patient the record belongs to, or their guardian.
     *
     * The one control standing between two patients of the SAME clinic. Row-level
     * security cannot help here: both rows carry the same tenant_id, so the
     * database is satisfied and the answer has to come from authorisation.
     *
     * Deactivation revokes it, exactly as it revokes a staff role. A patient whose
     * account was disabled after a disputed claim must not keep reading the
     * record on the strength of the link alone.
     *
     * Callers must also check sameTenant(). This says whose record it is, not
     * which clinic it is at.
     */
    protected function isPatientOf(User $user, ?string $patientId): bool
    {
        if (! $user->is_active) {
            return false;
        }

        return $user->owns($patientId);
    }
}
