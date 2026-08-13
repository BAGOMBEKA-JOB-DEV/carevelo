<?php

namespace App\Http\Requests\V1\Patients;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Http\Requests\V1\Patients\Concerns\RequiresGuardianForMinors;
use App\Models\Patient;
use App\Rules\UgandanPhone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Correcting a patient's contact and demographic details.
 *
 * `status` is absent by design. A patient moves between states through consent
 * decisions and phone verification, never through a field assignment -- a
 * status column anything can write is not a state machine.
 *
 * @see docs/20-domain/state-machines.md
 */
class UpdatePatientRequest extends FormRequest
{
    use NormalisesPhoneNumbers;
    use RejectsUnknownFields;
    use RequiresGuardianForMinors;

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
            'given_name' => ['sometimes', 'string', 'max:100'],
            'family_name' => ['sometimes', 'string', 'max:100'],
            'phone' => ['sometimes', 'string', new UgandanPhone],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'date_of_birth' => ['sometimes', 'nullable', 'date', 'before:tomorrow'],
            'sex' => ['sometimes', 'nullable', Rule::in(['female', 'male', 'other', 'prefer_not_to_say'])],
            'national_id_number' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'district' => ['sometimes', 'nullable', 'string', 'max:100'],
            'guardian_name' => ['sometimes', 'nullable', 'string', 'max:200'],
            'guardian_phone' => ['sometimes', 'nullable', 'string', new UgandanPhone],
            'guardian_relationship' => ['sometimes', 'nullable', 'string', 'max:60'],
        ];
    }

    /**
     * The minor check runs against the RESULTING record, not the payload.
     *
     * A patch that only clears `guardian_phone` never mentions the date of
     * birth, so judging the payload alone would let a minor's guardian details
     * be erased one field at a time.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $patient = $this->route('patient');
            $patient = $patient instanceof Patient ? $patient : null;

            $dateOfBirth = $this->has('date_of_birth')
                ? $this->input('date_of_birth')
                : $patient?->date_of_birth;

            if (! $this->isMinor($dateOfBirth)) {
                return;
            }

            foreach ($this->guardianFields as $field) {
                $resulting = $this->has($field) ? $this->input($field) : $patient?->getAttribute($field);

                if (blank($resulting)) {
                    $validator->errors()->add($field, $this->guardianMessage());
                }
            }
        });
    }
}
