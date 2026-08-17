<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Delivery;
use App\Models\User;

class DeliveryPolicy
{
    use HandlesTenantAuthorisation;

    /** The dispatch board. Riders never see it. */
    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Dispatcher,
            ClinicalRole::Pharmacist,
        ]);
    }

    /**
     * The patient's own deliveries.
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

    public function view(User $user, Delivery $delivery): bool
    {
        if (! $this->sameTenant($user, $delivery->tenant_id)) {
            return false;
        }

        return $this->viewAny($user) || $this->isAssignedRider($user, $delivery);
    }

    /**
     * Follow a delivery's progress — status milestones, never its contents.
     *
     * Separate from view() on purpose, and the separation is the control rather
     * than tidiness. view() returns the delivery, which names the recipient and
     * the address and hangs off an order whose items are medicines. Tracking
     * returns a list of statuses and timestamps.
     *
     * The patient is the person actually waiting, so they hold this and not
     * view(). Widening view() to include them instead would have handed them the
     * whole record, and the catalogue is explicit: "Status milestones. Never
     * contents."
     */
    public function track(User $user, Delivery $delivery): bool
    {
        if (! $this->sameTenant($user, $delivery->tenant_id)) {
            return false;
        }

        return $this->viewAny($user)
            || $this->isAssignedRider($user, $delivery)
            || $this->isPatientOf($user, $delivery->patientId());
    }

    public function assign(User $user, Delivery $delivery): bool
    {
        return $this->sameTenant($user, $delivery->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Dispatcher]);
    }

    /**
     * A rider updates the status of their OWN assignment and nothing else.
     *
     * The most restricted permission in the system: the rider is the
     * least-trusted human actor and needs the least data.
     */
    public function updateStatus(User $user, Delivery $delivery): bool
    {
        return $this->sameTenant($user, $delivery->tenant_id)
            && $this->isAssignedRider($user, $delivery);
    }

    protected function isAssignedRider(User $user, Delivery $delivery): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Rider])
            && $delivery->rider_id === $user->id;
    }
}
