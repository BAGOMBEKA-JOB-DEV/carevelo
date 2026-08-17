<?php

namespace App\Http\Requests\V1\Patients;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\Patient;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Folding a duplicate registration into the record that survives.
 *
 * The route's {patient} is the SURVIVOR and the body names the duplicate. That
 * way round because the survivor is the record the front desk already has open,
 * and because it makes the URL the thing that is kept -- a caller who confuses
 * the two loses the wrong history in a way no validation could detect.
 *
 * `exists` is evaluated with row-level security bound, so an identifier from
 * another clinic does not resolve and the response is the same as for one that
 * never existed. The isolation boundary is not something this endpoint has to
 * remember to check.
 */
class MergePatientRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Authorisation is the controller's policy call; shaping input is this class's job. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'duplicate_patient_id' => [
                'required', 'string', 'ulid',
                'different:patient',
                'exists:patients,id',
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'duplicate_patient_id.different' => 'A record cannot be merged into itself.',
        ];
    }

    /**
     * The survivor's id, so `different:patient` has something to compare against.
     *
     * Route parameters are absent from all(), so this adds one for the validator
     * only. It stays out of the unknown-field check for the same reason: that
     * check reads all(), which is client input, and this is not.
     *
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        $patient = $this->route('patient');

        return [
            ...$this->all(),
            'patient' => $patient instanceof Patient ? $patient->getKey() : null,
        ];
    }

    public function duplicatePatientId(): string
    {
        return (string) $this->validated('duplicate_patient_id');
    }
}
