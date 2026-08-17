<?php

namespace App\Http\Requests\Admin\Staff;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Models\ClinicalRole;
use App\Rules\UgandanPhone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Inviting a member of staff by phone number.
 *
 * The phone is the invitation address because it is the credential this market
 * actually has: most Ugandan clinic staff have a working handset and no
 * reliably checked email address.
 *
 * The ROLE IS FIXED HERE, by the administrator, and the person accepting the
 * invitation cannot change it. Self-elevation on acceptance would make the
 * whole RBAC matrix advisory.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 6
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class InviteStaffRequest extends FormRequest
{
    use NormalisesPhoneNumbers;
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * The roles a clinic administrator may hand out.
     *
     * Tenant roles minus `patient`: a patient is not staff and holds an
     * entirely different relationship with the clinic. Platform roles are
     * absent by construction -- a clinic cannot mint a Carevelo operator, and
     * `break_glass` is granted by an audited platform process, never by an
     * invitation SMS.
     *
     * @return list<string>
     */
    public static function assignableRoles(): array
    {
        return array_values(array_map(
            static fn (ClinicalRole $role): string => $role->value,
            array_filter(
                ClinicalRole::tenantRoles(),
                static fn (ClinicalRole $role): bool => $role !== ClinicalRole::Patient,
            ),
        ));
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
            'name' => ['required', 'string', 'max:200'],
            'phone' => ['required', 'string', new UgandanPhone],
            'role' => ['required', 'string', Rule::in(self::assignableRoles())],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'role.in' => 'Choose one of the clinic\'s own roles: '.implode(', ', self::assignableRoles()).'.',
        ];
    }
}
