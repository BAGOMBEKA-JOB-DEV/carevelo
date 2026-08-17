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

    /**
     * The patient's own payment attempts.
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

    /**
     * A patient may read their own payment attempt, and its receipt.
     *
     * They polled this endpoint while the mobile-money prompt was on their
     * handset, so refusing it leaves them unable to find out whether they paid --
     * and the receipt naming the CLINIC as payee is the only proof they have.
     *
     * Ownership resolves through the payable, since an intent records what is
     * being paid for rather than who is paying.
     */
    public function view(User $user, PaymentIntent $intent): bool
    {
        if (! $this->sameTenant($user, $intent->tenant_id)) {
            return false;
        }

        return $this->viewAny($user) || $this->isPatientOf($user, $intent->patientId());
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
