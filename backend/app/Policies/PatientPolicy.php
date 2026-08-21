<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\User;

/**
 * Default deny. Every method states who MAY act; anyone else is refused.
 *
 * Note what is absent: no rider method. A rider can reach no patient record at
 * all -- they receive a recipient name on a delivery and nothing more.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class PatientPolicy
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

    public function view(User $user, Patient $patient): bool
    {
        if (! $this->sameTenant($user, $patient->tenant_id)) {
            return false;
        }

        // Pharmacists and dispatchers see name and contact only, which is
        // enforced by a separate resource class rather than here.
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Clinician,
            ClinicalRole::FrontDesk,
            ClinicalRole::Pharmacist,
        ]);
    }

    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [
            ClinicalRole::ClinicAdmin,
            ClinicalRole::Clinician,
            ClinicalRole::FrontDesk,
        ]);
    }

    public function update(User $user, Patient $patient): bool
    {
        return $this->sameTenant($user, $patient->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::Clinician,
                ClinicalRole::FrontDesk,
            ]);
    }

    /**
     * Fold a duplicate registration into this record.
     *
     * Administrator and front desk only -- NOT a clinician, who may update a
     * record but should not be re-pointing which record a consultation belongs
     * to. This is a registration-desk correction, and the front desk is who
     * creates the duplicates in the first place.
     *
     * Within a tenant only. There is no cross-tenant variant of this ability
     * because there is no cross-tenant patient identity to merge onto.
     */
    public function merge(User $user, Patient $patient): bool
    {
        return $this->sameTenant($user, $patient->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::FrontDesk,
            ]);
    }

    /**
     * Create the patient's own sign-in account and link it to this record.
     *
     * Administrator and front desk only. NOT the clinician, for the reason
     * merge() excludes them and it applies verbatim: this is a registration-desk
     * act, and the desk is where the person and their ID document actually are.
     * The entire trust basis of the account is "a member of staff verified the
     * human being in front of them" -- a clinician mid-consultation in a back
     * room is not positioned to do that, and a policy that let them would turn an
     * attestation into a formality.
     *
     * NOT the patient either, even on their own record. Self-service account
     * creation would mean anybody who knows a patient's name and a record
     * identifier could mint a login onto a medical record, and the record is
     * exactly what the account grants sight of.
     */
    public function createAccount(User $user, Patient $patient): bool
    {
        return $this->sameTenant($user, $patient->tenant_id)
            && $this->hasAnyRole($user, [
                ClinicalRole::ClinicAdmin,
                ClinicalRole::FrontDesk,
            ]);
    }

    /**
     * Nobody deletes a patient.
     *
     * Erasure is a controller decision handled through the retention process,
     * not an API action -- and the clinic may be legally obliged to retain the
     * medical record regardless.
     */
    public function delete(User $user, Patient $patient): bool
    {
        return false;
    }
}
