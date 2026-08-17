<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Prescription;
use App\Models\User;

class PrescriptionPolicy
{
    use HandlesTenantAuthorisation;

    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Clinician,
            ClinicalRole::Pharmacist,
        ]);
    }

    /**
     * The patient's own prescriptions.
     *
     * Grants entry to a LISTING only, and only alongside the scoping in
     * AuthorisesPatientReads -- holding this and querying unscoped would hand one
     * patient the whole clinic's records. Which rows are theirs is settled by
     * isPatientOf(), not by this.
     */
    public function viewOwn(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Patient]);
    }

    public function view(User $user, Prescription $prescription): bool
    {
        if (! $this->sameTenant($user, $prescription->tenant_id)) {
            return false;
        }

        return $this->viewAny($user) || $this->isPatientOf($user, $prescription->patient_id);
    }

    /** Only a clinician issues a prescription. It is a clinical act. */
    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }

    /**
     * Nobody edits a prescription. Ever.
     *
     * Not the clinician, not the administrator, not Carevelo. Correction is
     * cancel-and-replace, and this absence is deliberate.
     */
    public function update(User $user, Prescription $prescription): bool
    {
        return false;
    }

    public function delete(User $user, Prescription $prescription): bool
    {
        return false;
    }

    public function cancel(User $user, Prescription $prescription): bool
    {
        return $this->sameTenant($user, $prescription->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }
}
