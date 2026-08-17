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

    /**
     * The patient's own appointments.
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

    public function view(User $user, Appointment $appointment): bool
    {
        if (! $this->sameTenant($user, $appointment->tenant_id)) {
            return false;
        }

        return $this->viewAny($user) || $this->isPatientOf($user, $appointment->patient_id);
    }

    public function create(User $user): bool
    {
        return $this->viewAny($user);
    }

    /**
     * Cancelling is the patient's own decision as much as the clinic's.
     *
     * A patient who cannot cancel telephones the clinic instead, and a slot nobody
     * released is a slot nobody else could book.
     */
    public function cancel(User $user, Appointment $appointment): bool
    {
        if (! $this->sameTenant($user, $appointment->tenant_id)) {
            return false;
        }

        return $this->viewAny($user) || $this->isPatientOf($user, $appointment->patient_id);
    }

    /**
     * Ask for a token to enter this consultation.
     *
     * The two people who belong in the room: the patient whose appointment it is,
     * and the clinic's clinical staff. An administrator is deliberately excluded
     * -- they may read that a consultation happened, which the audit trail gives
     * them, but sitting in on one is a different act entirely and no clinic asked
     * for it.
     *
     * Whether the appointment is at a joinable moment is decided by the
     * controller, not here: that is a question about state, and a policy that
     * mixes state into an authorisation answer produces "forbidden" for what is
     * really "not yet".
     */
    public function join(User $user, Appointment $appointment): bool
    {
        if (! $this->sameTenant($user, $appointment->tenant_id)) {
            return false;
        }

        return $this->hasAnyRole($user, [ClinicalRole::Clinician])
            || $this->isPatientOf($user, $appointment->patient_id);
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
