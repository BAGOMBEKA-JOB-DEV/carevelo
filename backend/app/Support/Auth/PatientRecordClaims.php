<?php

namespace App\Support\Auth;

use App\Audit\AuditLog;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Attaches a patient's own records to their account, once they have proved the
 * handset.
 *
 * Front desk registers a walk-in against a phone number long before that person
 * has any login. The record and the account then exist independently, and
 * something has to join them — without this the patient-account link is a column
 * nothing ever fills, and every `P own` endpoint returns an empty list to a
 * patient who plainly has records.
 *
 * THE PHONE NUMBER IS THE PROOF, AND IT MUST BE A VERIFIED ONE. Claiming grants a
 * human being sight of a medical record, so it may only follow a one-time code
 * that proved control of the handset — never a number merely typed into a form.
 * That is why this is called from OTP verification and not from registration.
 *
 * `(tenant_id, phone)` is unique on both tables, so within one clinic a number
 * identifies at most one patient record and at most one account. The claim is
 * therefore unambiguous rather than a best guess.
 *
 * A guardian ends up holding several records because each of their children was
 * registered against their number — see ADR-0010 for why that is one-to-many.
 *
 * @see docs/70-decisions/0010-patient-account-link.md
 * @see docs/40-api/authentication-and-sessions.md
 */
class PatientRecordClaims
{
    public function __construct(protected AuditLog $audit) {}

    /**
     * Link any unclaimed record at this clinic whose number matches the account's.
     *
     * Returns the number of records claimed, which is normally zero: the link
     * survives, so this does real work only on a patient's first sign-in or after
     * front desk has registered them afresh.
     */
    public function attach(User $user): int
    {
        // Staff accounts are not patients of the clinic they work at -- and if one
        // genuinely is, that is a second account, exactly as attending two clinics
        // is two accounts. Claiming on a clinician's sign-in would hand them a
        // patient record through a side door that no policy inspects.
        if (! $user->hasRole(ClinicalRole::Patient->value)) {
            return 0;
        }

        $phone = $user->getAttribute('phone');

        if ($phone === null || $user->getAttribute('phone_verified_at') === null) {
            return 0;
        }

        $claimed = DB::transaction(function () use ($user, $phone): array {
            // Only UNCLAIMED records. A record already attached to another account
            // is never reassigned here: a phone number changing hands is a real
            // event, and moving a medical record on the strength of it is a
            // decision for clinic staff, not a side effect of somebody signing in.
            $records = Patient::query()
                ->whereNull('user_id')
                ->where('phone', (string) $phone)
                ->lockForUpdate()
                ->get();

            foreach ($records as $record) {
                $record->user_id = $user->id;
                $record->save();
            }

            return $records->pluck('id')->all();
        });

        foreach ($claimed as $patientId) {
            // Audited individually. This is the moment a person gained sight of a
            // medical record, and "who can read my records, and since when" has to
            // be answerable per record rather than per sign-in.
            $this->audit->record('patient.record_claimed', 'Patient', (string) $patientId, [
                'via' => 'verified_phone',
            ], $user);
        }

        return count($claimed);
    }
}
