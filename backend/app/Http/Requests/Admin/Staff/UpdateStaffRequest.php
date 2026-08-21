<?php

namespace App\Http\Requests\Admin\Staff;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Rules\UgandanPhone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Correcting a staff member's details, role or access.
 *
 * `tenant_id` is prohibited rather than absent. Moving a person between clinics
 * is never legitimate -- there is no cross-tenant staff identity, so someone
 * working at two clinics has two accounts -- and a prohibited field says that
 * out loud instead of discarding the value in silence.
 *
 * Passwords are not set here. A person sets their own; an administrator who
 * could write another user's password could read every clinical record that user
 * can reach, which defeats the role boundary entirely.
 *
 * The one place a password is issued rather than chosen is a patient account
 * created at the registration desk, where there is no other way to hand somebody
 * their first credential. Even there the staff member does not choose it: the
 * server generates it, shows it once, and the account can do nothing but replace
 * it until it does.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class UpdateStaffRequest extends FormRequest
{
    use NormalisesPhoneNumbers;
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalisePhoneFields(['phone']);
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:200'],
            'phone' => ['sometimes', 'string', new UgandanPhone],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'is_active' => ['sometimes', 'boolean'],
            'role' => ['sometimes', 'string', Rule::in(InviteStaffRequest::assignableRoles())],

            'tenant_id' => ['prohibited'],
            'password' => ['prohibited'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'role.in' => 'Choose one of the clinic\'s own roles: '
                .implode(', ', InviteStaffRequest::assignableRoles()).'.',
            'tenant_id.prohibited' => 'Staff belong to exactly one clinic and cannot be moved between clinics. '
                .'Someone working at two clinics has two accounts.',
            'password.prohibited' => 'A person sets their own password. Nobody sets it for them.',
        ];
    }
}
