<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Substitution;
use App\Models\User;

class SubstitutionPolicy
{
    use HandlesTenantAuthorisation;

    /** The pharmacist proposes. */
    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Pharmacist]);
    }

    /**
     * ONLY a clinician decides.
     *
     * Not the pharmacist who proposed it, and not the administrator. A
     * substitution is a clinical decision, and there is no auto-approval.
     */
    public function decide(User $user, Substitution $substitution): bool
    {
        return $this->sameTenant($user, $substitution->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }
}
