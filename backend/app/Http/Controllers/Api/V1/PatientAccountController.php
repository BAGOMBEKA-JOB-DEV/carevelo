<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Patients\CreatePatientAccountRequest;
use App\Http\Responses\ProblemDetails;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\User;
use App\Support\Auth\Accounts;
use App\Support\Auth\InitialPassword;
use App\Support\Auth\PatientRecordClaims;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;

/**
 * Giving a patient a way in, at the registration desk.
 *
 * There was no patient account-creation path in the product at all. A patient
 * record could be registered, consented, consulted and dispensed against, and
 * the person it described still had no way to sign in and look at any of it --
 * the demo seeder was the only reason a patient could sign in anywhere.
 *
 * CLINIC STAFF CREATE THE ACCOUNT. Not self-service, and the difference is the
 * whole design: the account grants a human being sight of a medical record, so
 * something has to establish that the human being is the right one. Front desk,
 * with the person and their ID document across the counter, is the only place in
 * this product where that check actually happens. Self-registration would move
 * it to a form, and a form checks nothing.
 *
 * NOT in the Api\Admin namespace, where the clinic's own administration lives
 * behind administeredTenant(). This is an act on one patient record: it belongs
 * beside ConsentController and JoinTokenController, nested under the resource,
 * authorised by PatientPolicy, and bound through row-level security so another
 * clinic's record 404s rather than 403s.
 *
 * There is no GET. An endpoint whose job is answering "does this person have an
 * account here" is a question worth not being able to ask; the derived
 * `has_account` flag on PatientResource tells staff what they need while they
 * are already reading the record they are entitled to read. There is no DELETE
 * either -- an account is deactivated through the staff surface, and a login
 * that could be destroyed would take the audit trail's explanation of who read
 * what with it.
 *
 * @see docs/70-decisions/0010-patient-account-link.md
 * @see docs/40-api/authentication-and-sessions.md
 */
class PatientAccountController extends Controller
{
    public function __construct(
        protected AuditLog $audit,
        protected Accounts $accounts,
        protected InitialPassword $passwords,
        protected PatientRecordClaims $claims,
    ) {}

    /**
     * Create the account, link the record, and return the password once.
     */
    public function store(CreatePatientAccountRequest $request, Patient $patient): JsonResponse
    {
        $this->authorize('createAccount', $patient);

        $this->assertRecordCanHoldAnAccount($patient);

        if ($patient->isClaimed()) {
            return ProblemDetails::make(
                409,
                'patient_already_has_account',
                'This patient already has an account',
                'They sign in with the address the clinic already holds. If they have lost the '
                .'password, they can no longer be given a new one here.',
            );
        }

        $email = $request->email();

        // Checked first AND caught below. Two front-desk terminals working the
        // queue at once is the normal case, not the exotic one, so the window
        // between the check and the insert is a window that opens in practice.
        // PatientController::store does the same for a duplicate phone number.
        if ($this->accounts->activeForEmail($email) !== null) {
            return $this->addressInUse();
        }

        $initialPassword = $this->passwords->generate();

        try {
            $account = DB::transaction(
                fn (): User => $this->createAccount($patient, $email, $initialPassword),
            );
        } catch (UniqueConstraintViolationException) {
            // The unique index on (tenant_id, email) settled the race, or the
            // address belongs to a DEACTIVATED account -- which activeForEmail()
            // deliberately does not see, because a "your account is disabled"
            // answer at sign-in would confirm the account exists.
            //
            // A 409 rather than a neutral 201 is right here and nowhere near
            // sign-in: the caller is an authenticated member of staff who can
            // already read every patient record and every address at this clinic,
            // so there is no enumeration surface to protect. What there is
            // instead is a person standing at a desk who needs to be told the
            // truth about why they cannot proceed.
            return $this->addressInUse();
        }

        return new JsonResponse([
            'data' => [
                'patient_id' => $patient->id,
                'user_id' => $account->id,
                'email' => $account->email,

                // The only moment the plaintext exists outside the patient's own
                // head. It is stored as a hash, never audited, never logged, and
                // never sent by SMS.
                'initial_password' => $initialPassword,

                // Always one: the endpoint creates a fresh account and links the
                // single record it was called on. It is here so the desk can see
                // that the link happened, because the link -- not the account --
                // is what puts records in front of the patient.
                'records_linked' => 1,

                'note' => 'Read this password to the patient now. It is shown once and cannot be '
                    .'recovered. They must change it the first time they sign in.',
            ],
        ], 201);
    }

    /**
     * The account, the role, the forced change and the link, in one transaction.
     *
     * A failure at any point must leave no account behind: a User with the
     * patient role and no linked record is a login that can sign in, see nothing,
     * and hold an address that blocks the retry.
     */
    private function createAccount(Patient $patient, string $email, string $initialPassword): User
    {
        $account = User::create([
            'tenant_id' => $patient->tenant_id,

            // Derived from the clinical record rather than typed again. One
            // spelling of a patient's name, in one place.
            'name' => trim($patient->given_name.' '.$patient->family_name),

            'email' => $email,
            'password' => $initialPassword,
            'is_active' => true,
        ]);

        // phone is left NULL deliberately, and so is phone_verified_at.
        //
        // phone_verified_at because the only thing that ever set it was a token
        // proving control of a handset, and a desk visit proves nothing of the
        // kind. StaffResource surfaces that column to administrators precisely so
        // a clinic can tell a genuinely verified contact number from one typed at
        // a front desk; writing it here would poison the signal for every
        // consumer of it.
        //
        // phone because users carries unique(tenant_id, phone), and the two
        // ordinary collisions -- a member of staff who is also a patient here,
        // and a record registered against a next-of-kin number -- would each turn
        // a legitimate desk action into a duplicate-key failure.

        $account->assignRole(ClinicalRole::Patient->value);

        // The password was chosen by somebody else and spoken aloud, so it is
        // good for exactly one thing: replacing itself.
        $account->password_change_required_at = Date::now();
        $account->save();

        $this->audit->record('patient.account_created', 'Patient', $patient->id, [
            'user_id' => $account->id,
            'via' => 'staff_issued',
        ]);

        // The one production writer of patients.user_id. It re-checks the role,
        // the tenant and the existing owner under a row lock, and audits the
        // claim separately -- "who can read my records, and since when" is a
        // question about the record, not about the account.
        $this->claims->attachRecord($account, $patient);

        return $account;
    }

    /**
     * Records that are not the person any more, or never became one.
     *
     * @throws IllegalTransition
     */
    private function assertRecordCanHoldAnAccount(Patient $patient): void
    {
        if ($patient->isMerged()) {
            throw new IllegalTransition(
                'This registration was a duplicate and its history moved to another record. '
                .'Create the account on the record that survived.'
            );
        }

        if ($patient->status === PatientStatus::Discarded) {
            // Discarded means consent was declined, and declining is the answer
            // being respected. An account is a way into a record that only exists
            // to explain why service could not proceed.
            throw new IllegalTransition(
                'This registration ended when consent was declined. Register again to start over.'
            );
        }
    }

    private function addressInUse(): JsonResponse
    {
        return ProblemDetails::make(
            409,
            'account_exists',
            'That address already has an account at this clinic',
            'Use a different address, or ask the patient to sign in with the one they have.',
        );
    }
}
