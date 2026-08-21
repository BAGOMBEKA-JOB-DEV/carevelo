<?php

namespace App\Http\Requests\V1\Patients;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Creating a patient's own sign-in account, at the registration desk.
 *
 * One field arrives from the desk: the address the patient wants to sign in
 * with. Everything else about the account is derived or generated, and the two
 * fields that are conspicuously prohibited are the point of this class.
 *
 * PASSWORD IS PROHIBITED. UpdateStaffRequest makes exactly this prohibition for
 * exactly this reason -- somebody who can write another person's password can
 * read everything that person can reach -- and there is a second reason here
 * that is specific to a front desk. A staff member creating twenty accounts a
 * day types the same password twenty times, and then every account at that
 * clinic is guessable by anyone who was ever given one. The server generates a
 * readable passphrase and shows it once instead; see InitialPassword.
 *
 * NAME IS PROHIBITED. The account's name is taken from the patient record it is
 * created against. A second spelling of a patient's name, typed separately and
 * free to drift from the clinical record, is a data-quality trap with nothing on
 * the other side of it: staff would then be reading two names for one person and
 * no rule says which is right.
 *
 * There is no `phone` field. `users` carries `unique(tenant_id, phone)` and
 * writing one here breaks on two ordinary cases -- a member of staff who is also
 * a patient of the clinic, and the documented "patient has no phone, register
 * against a next-of-kin number" exception -- either of which would turn a
 * legitimate desk action into a duplicate-key failure. Notifications are
 * unaffected: ownership resolves through `patients.phone`, never `users.phone`.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class CreatePatientAccountRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * The controller consults PatientPolicy explicitly, which is where the
     * default-deny answer belongs. Duplicating it here would give two places to
     * change and one to forget.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email:rfc', 'max:255'],

            'password' => ['prohibited'],
            'name' => ['prohibited'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            // The refusal a patient with no email address meets. It says what to
            // do rather than what went wrong: an account is not a precondition of
            // care, and a clinic must not feel pushed into inventing an address
            // to get past this screen. Minting a placeholder is what
            // StaffInvitation does, and it is right there only because the phone
            // was the credential -- here it would create an account nobody can
            // ever sign into.
            'email.required' => 'A patient signs in with an email address, so one is needed to '
                .'create the account. A patient without an address is registered and treated as '
                .'normal; create the account when they have one.',
            'password.prohibited' => 'The system sets the initial password and shows it to you '
                .'once. Nobody chooses another person\'s password.',
            'name.prohibited' => 'The account is named from the patient record, so there is only '
                .'ever one spelling of a patient\'s name to keep right.',
        ];
    }

    /**
     * The address the account will sign in with.
     *
     * Lowercased, because addresses are not case-sensitive in practice and
     * "Sarah@" failing where "sarah@" works is a support call, not a security
     * control. SignInRequest lowercases the identifier the same way, so the two
     * halves agree about what one address is.
     */
    public function email(): string
    {
        return mb_strtolower(trim((string) $this->validated('email')));
    }
}
