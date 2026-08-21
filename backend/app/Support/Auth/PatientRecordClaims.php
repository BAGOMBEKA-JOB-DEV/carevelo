<?php

namespace App\Support\Auth;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The one production writer of `patients.user_id`.
 *
 * Front desk registers a walk-in long before that person has any login, so the
 * record and the account exist independently and something has to join them.
 * Without this the patient-account link is a column nothing ever fills, and every
 * `P own` endpoint returns an empty list to a patient who plainly has records.
 *
 * THE PROOF IS A MEMBER OF STAFF WHO SAW THE PERSON. It was a verified phone
 * number, and that gate cannot be honestly satisfied any more: the one-time-code
 * path was the only thing that ever set `users.phone_verified_at`, and it is
 * gone. What replaced it is a registration-desk act -- clinic staff create the
 * account against a named record, having the human being and their ID document
 * in front of them -- so the record named in the call is the record linked, and
 * nothing is inferred from a field that merely matches.
 *
 * The sweep that used to live here (find every unclaimed record whose phone
 * equals the account's) is deliberately not relaxed but deleted. Relaxing it
 * would have meant claiming a medical record on the strength of a number typed
 * into a form, which is the failure the old docblock spent a paragraph refusing.
 * Its "a guardian holds several records" story was never achievable either:
 * `patients` carries `unique(tenant_id, phone)`, so within one clinic a number
 * identifies at most one record.
 *
 * ADR-0010's cardinality survives untouched. One account may still hold several
 * records -- a guardian and their children -- but each link is now a separate,
 * audited act by a member of staff rather than a side effect of signing in.
 *
 * @see docs/70-decisions/0010-patient-account-link.md
 * @see docs/40-api/authentication-and-sessions.md
 */
class PatientRecordClaims
{
    public function __construct(protected AuditLog $audit) {}

    /**
     * Link one named record to one account.
     *
     * In a single transaction, so a refusal leaves nothing behind and two front
     * desks racing on the same record cannot both win.
     *
     * @throws IllegalTransition when the account may not hold this record
     */
    public function attachRecord(User $user, Patient $patient): void
    {
        // Staff accounts are not patients of the clinic they work at -- and if one
        // genuinely is, that is a second account, exactly as attending two clinics
        // is two accounts. THIS IS THE LINE that stops a clinician acquiring a
        // patient record through a side door no policy inspects, and it is kept
        // verbatim from the sweep it replaces.
        if (! $user->hasRole(ClinicalRole::Patient->value)) {
            throw new IllegalTransition(
                'Only a patient account can hold a patient record. A member of staff who is '
                .'also a patient here needs a separate patient account.'
            );
        }

        // Row-level security and the composite foreign key on (tenant_id, user_id)
        // already make a cross-tenant link impossible. The FK's refusal is a
        // QueryException and therefore a 500, though, and on the single write that
        // grants a human being sight of a medical record an explicit clean refusal
        // is worth the two lines.
        if ($user->tenant_id === null || $user->tenant_id !== $patient->tenant_id) {
            throw new IllegalTransition('That account belongs to another clinic.');
        }

        DB::transaction(function () use ($user, $patient): void {
            // Re-read FOR UPDATE. Two registration terminals creating an account
            // for the same person at the same moment would otherwise both find the
            // record unclaimed, and the second would silently take it from the
            // first.
            $record = Patient::query()
                ->whereKey($patient->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if ($record->user_id !== null) {
                // Never reassigned here. Moving a medical record from one account
                // to another is a decision for clinic staff working through a
                // correction, not something this method does on the way past.
                throw new IllegalTransition(
                    'Another account already reaches this record. Ask the clinic to correct it.'
                );
            }

            $record->user_id = $user->id;
            $record->save();

            // Audited per record, inside the same transaction as the write.
            // "Who can read my records, and since when" has to be answerable per
            // record rather than per account.
            //
            // The ACTION NAME is unchanged from the phone-verified era on purpose:
            // an existing clinic's audit trail must not fork into two vocabularies
            // for "an account gained sight of this record". `via` is where the
            // trust basis changed, and it is the field to read when asking what
            // actually proved anything.
            $this->audit->record('patient.record_claimed', 'Patient', $record->id, [
                'via' => 'staff_attested',
            ]);

            $patient->setAttribute('user_id', $record->user_id);
        });
    }
}
