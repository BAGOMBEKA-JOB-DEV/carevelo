<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\DispenseOrder;
use App\Models\User;

class DispenseOrderPolicy
{
    use HandlesTenantAuthorisation;

    /** The pharmacy queue. */
    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Pharmacist]);
    }

    public function view(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::Pharmacist,
                ClinicalRole::Clinician,
            ]);
    }

    /**
     * Take the order off the queue for review.
     *
     * Separate from price() so a clinic can grant "look at the queue and start
     * work" without granting "set what the patient pays". Same role set today;
     * separately grantable tomorrow without touching a controller.
     */
    public function open(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Pharmacist]);
    }

    /**
     * Refuse the order outright.
     *
     * Distinct from pricing because refusing is a decision the patient feels
     * immediately -- it ends their order -- and a clinic may reasonably want it
     * held to the administrator alone.
     */
    public function reject(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Pharmacist]);
    }

    public function price(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Pharmacist]);
    }

    /** Only the pharmacy dispenses. Carevelo never does. */
    public function dispense(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::Pharmacist]);
    }

    /**
     * Record whether the patient is collecting or having it delivered.
     *
     * The decision is the PATIENT'S; this ability is who may record it. In a
     * Ugandan clinic that is whoever is at the counter when they say so -- the
     * pharmacist handing the order over, or the front desk taking the call.
     *
     * The patient's own portal access is not here yet, because a User is not yet
     * linked to a Patient anywhere in this system (see App\Broadcasting\
     * PatientChannel, which documents the same gap). When that linkage arrives
     * the patient role is added HERE, to this one method, and no controller
     * changes.
     */
    public function chooseFulfilment(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::Pharmacist,
                ClinicalRole::FrontDesk,
            ]);
    }

    /**
     * Hand a collected order over at the counter.
     *
     * Pharmacist only, and for the same reason as dispense(): this is the moment
     * medicine physically leaves the clinic's pharmacy, and it is attributable to
     * the licensed staff who released it (NDPA Act Cap 206). An administrator who
     * may price an order still may not hand one over.
     */
    public function collect(User $user, DispenseOrder $order): bool
    {
        return $this->sameTenant($user, $order->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::Pharmacist]);
    }
}
