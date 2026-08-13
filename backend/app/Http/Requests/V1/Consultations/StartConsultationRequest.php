<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\ConsultationMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;
use Illuminate\Validation\Rules\Exists;

/**
 * Starting a consultation.
 *
 * The appointment is looked up by id and nothing else. There is no tenant field
 * here or anywhere else in a request body -- tenancy comes from the host or the
 * session, and the `exists` rule runs under row-level security, so an
 * appointment belonging to another clinic simply is not there to be found.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 */
class StartConsultationRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Authorisation is the policy's job, consulted in the controller. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|Enum|Exists>>
     */
    public function rules(): array
    {
        return [
            'appointment_id' => ['required', 'string', Rule::exists('appointments', 'id')],

            // Optional, and only ever the mode ACTUALLY in use. A clinician who
            // knows the patient's connection will not carry video says so at
            // the start rather than after a failed attempt; the booked mode is
            // left untouched as the record of what was agreed.
            'mode_used' => ['sometimes', Rule::enum(ConsultationMode::class)],
        ];
    }
}
