<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Consultation;
use App\Models\User;

class ConsultationPolicy
{
    use HandlesTenantAuthorisation;

    /**
     * The clinic's own encounters, as a list.
     *
     * A clinic_admin who is not a clinician may read consultations --
     * administrators of small clinics genuinely need this -- but every such
     * read is audited. Nobody else on the staff side appears: front desk books
     * appointments and never opens the encounter behind one, and a pharmacist
     * reaches what they need through the dispense order.
     */
    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Clinician]);
    }

    /**
     * The patient's own consultations.
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

    public function view(User $user, Consultation $consultation): bool
    {
        if (! $this->sameTenant($user, $consultation->tenant_id)) {
            return false;
        }

        // Expressed through viewAny() rather than repeating its role list, so
        // the single-record answer and the listing answer cannot drift apart.
        //
        // The patient may read the record of their own consultation. Their own
        // care is not confidential FROM them, and the clinical notes on it are
        // exactly what a second opinion needs.
        return $this->viewAny($user) || $this->isPatientOf($user, $consultation->patient_id);
    }

    /** Only a clinician conducts a consultation. */
    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }

    public function conduct(User $user, Consultation $consultation): bool
    {
        return $this->sameTenant($user, $consultation->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }
}
