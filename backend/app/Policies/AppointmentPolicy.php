<?php

namespace App\Policies;

use App\Models\Appointment;
use App\Models\ClinicalRole;
use App\Models\User;

class AppointmentPolicy
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

    public function view(User $user, Appointment $appointment): bool
    {
        return $this->sameTenant($user, $appointment->tenant_id) && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->viewAny($user);
    }

    public function cancel(User $user, Appointment $appointment): bool
    {
        return $this->sameTenant($user, $appointment->tenant_id) && $this->viewAny($user);
    }

    /**
     * Confirming an unpaid appointment is an audited staff decision, and only
     * the administrator may take it.
     */
    public function confirmDeferred(User $user, Appointment $appointment): bool
    {
        return $this->sameTenant($user, $appointment->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }
}
