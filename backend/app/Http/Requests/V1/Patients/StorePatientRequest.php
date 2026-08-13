<?php

namespace App\Http\Requests\V1\Patients;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Http\Requests\V1\Patients\Concerns\RequiresGuardianForMinors;
use App\Rules\UgandanPhone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Registration: the minimum a clinic needs to contact a person about care.
 *
 * Note what is NOT required, and never will be: `national_id_number`. Requiring
 * a NIN excludes patients, and exclusion is a worse outcome than unverified
 * identity ([Identifiers](../20-domain/identifiers-and-numbering.md)).
 *
 * Note also what is absent: `status`. A patient is created in `pending_consent`
 * and moves on only through a consent decision. A client that could post a
 * status could register an already-consenting patient.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 */
class StorePatientRequest extends FormRequest
{
    use NormalisesPhoneNumbers;
    use RejectsUnknownFields;
    use RequiresGuardianForMinors;

    /**
     * The controller consults PatientPolicy explicitly, which is where the
     * default-deny answer belongs. Duplicating it here would give two places to
     * change and one to forget.
     */
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalisePhoneFields(['phone', 'guardian_phone']);
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'given_name' => ['required', 'string', 'max:100'],
            'family_name' => ['required', 'string', 'max:100'],

            // Mandatory: the phone is how appointment details, payment prompts
            // and prescription-ready notifications reach the patient.
            //
            // Deliberately NOT `unique`. A "this number is already registered"
            // message confirms that a specific person is a patient of this
            // clinic, which is itself special-category disclosure under DPPA
            // 2019. The controller de-duplicates silently instead.
            'phone' => ['required', 'string', new UgandanPhone],

            'email' => ['nullable', 'email:rfc', 'max:255'],
            'date_of_birth' => ['nullable', 'date', 'before:tomorrow'],
            'sex' => ['nullable', Rule::in(['female', 'male', 'other', 'prefer_not_to_say'])],
            'national_id_number' => ['nullable', 'string', 'max:32'],
            'address' => ['nullable', 'string', 'max:255'],
            'district' => ['nullable', 'string', 'max:100'],

            'guardian_name' => ['nullable', 'string', 'max:200'],
            'guardian_phone' => ['nullable', 'string', new UgandanPhone],
            'guardian_relationship' => ['nullable', 'string', 'max:60'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (! $this->isMinor($this->input('date_of_birth'))) {
                return;
            }

            foreach ($this->guardianFields as $field) {
                if (blank($this->input($field))) {
                    $validator->errors()->add($field, $this->guardianMessage());
                }
            }
        });
    }
}
