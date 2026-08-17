<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Consultation;
use App\Models\User;

class ConsultationPolicy
{
    use HandlesTenantAuthorisation;

    /**
     * A clinic_admin who is not a clinician may read consultations --
     * administrators of small clinics genuinely need this -- but every such
     * read is audited.
     */
    public function view(User $user, Consultation $consultation): bool
    {
        if (! $this->sameTenant($user, $consultation->tenant_id)) {
            return false;
        }

        // The patient may read the record of their own consultation. Their own
        // care is not confidential FROM them, and the clinical notes on it are
        // exactly what a second opinion needs.
        return $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Clinician])
            || $this->isPatientOf($user, $consultation->patient_id);
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
