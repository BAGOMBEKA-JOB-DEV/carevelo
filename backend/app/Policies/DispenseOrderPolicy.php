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
