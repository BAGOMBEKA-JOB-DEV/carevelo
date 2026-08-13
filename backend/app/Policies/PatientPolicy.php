<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\User;

/**
 * Default deny. Every method states who MAY act; anyone else is refused.
 *
 * Note what is absent: no rider method. A rider can reach no patient record at
 * all -- they receive a recipient name on a delivery and nothing more.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class PatientPolicy
{
    use HandlesTenantAuthorisation;

    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Clinician,
            ClinicalRole::FrontDesk,
        ]);
    }

    public function view(User $user, Patient $patient): bool
    {
        if (! $this->sameTenant($user, $patient->tenant_id)) {
            return false;
        }

        // Pharmacists and dispatchers see name and contact only, which is
        // enforced by a separate resource class rather than here.
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Clinician,
            ClinicalRole::FrontDesk,
            ClinicalRole::Pharmacist,
        ]);
    }

    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Clinician,
            ClinicalRole::FrontDesk,
        ]);
    }

    public function update(User $user, Patient $patient): bool
    {
        return $this->sameTenant($user, $patient->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::Clinician,
                ClinicalRole::FrontDesk,
            ]);
    }

    /**
     * Nobody deletes a patient.
     *
     * Erasure is a controller decision handled through the retention process,
     * not an API action -- and the clinic may be legally obliged to retain the
     * medical record regardless.
     */
    public function delete(User $user, Patient $patient): bool
    {
        return false;
    }
}
