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

    public function view(User $user, Delivery $delivery): bool
    {
        if (! $this->sameTenant($user, $delivery->tenant_id)) {
            return false;
        }

        return $this->viewAny($user) || $this->isAssignedRider($user, $delivery);
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
