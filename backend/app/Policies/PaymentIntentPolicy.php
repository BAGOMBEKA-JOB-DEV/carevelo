<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\PaymentIntent;
use App\Models\User;

class PaymentIntentPolicy
{
    use HandlesTenantAuthorisation;

    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::FrontDesk,
            ClinicalRole::Pharmacist,
        ]);
    }

    public function view(User $user, PaymentIntent $intent): bool
    {
        return $this->sameTenant($user, $intent->tenant_id) && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::FrontDesk,
            ClinicalRole::Pharmacist,
        ]);
    }

    /** Cash attestation is the clinic's own internal control, and is audited. */
    public function attestCash(User $user, PaymentIntent $intent): bool
    {
        return $this->sameTenant($user, $intent->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::FrontDesk,
                ClinicalRole::Pharmacist,
            ]);
    }

    /** Only the administrator sees reconciliation. */
    public function reconcile(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    /**
     * There is no refund permission, because there is no refund capability.
     * Carevelo holds nothing to refund from.
     */
    public function refund(User $user, PaymentIntent $intent): bool
    {
        return false;
    }
}
