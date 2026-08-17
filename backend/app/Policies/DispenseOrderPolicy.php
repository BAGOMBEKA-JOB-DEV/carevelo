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

    /**
     * The patient's own dispense orders.
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

    public function view(User $user, DispenseOrder $order): bool
    {
        if (! $this->sameTenant($user, $order->tenant_id)) {
            return false;
        }

        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Pharmacist,
            ClinicalRole::Clinician,
        ]) || $this->isPatientOf($user, $order->patient_id);
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
    /**
     * Pickup or delivery: primarily the PATIENT's choice.
     *
     * The catalogue marks this `P own`, and it is their medicine and their
     * address. Staff keep the ability because plenty of patients decide at the
     * counter or over the telephone and someone has to record it.
     *
     * This is the deviation flagged during the last pass, when there was no
     * User -> Patient link and "the patient of this order" could not be
     * expressed at all. It now matches the RBAC matrix.
     */
    public function chooseFulfilment(User $user, DispenseOrder $order): bool
    {
        if (! $this->sameTenant($user, $order->tenant_id)) {
            return false;
        }

        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Pharmacist,
            ClinicalRole::FrontDesk,
        ]) || $this->isPatientOf($user, $order->patient_id);
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
