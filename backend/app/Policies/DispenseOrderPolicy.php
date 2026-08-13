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
}
