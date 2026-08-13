<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\ConsultationOutcome;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Ending a consultation.
 *
 * The outcome is REQUIRED. A consultation that simply stops records nothing
 * about why, and the exception paths -- no-show, clinician unavailable, remote
 * care judged unsafe, technical failure -- are the ones the clinic needs to
 * count. `converted_to_in_person` additionally forbids any prescription, so it
 * has to be captured at the moment the clinician decides, not inferred later.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 */
class EndConsultationRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string|Enum>>
     */
    public function rules(): array
    {
        return [
            'outcome' => ['required', Rule::enum(ConsultationOutcome::class)],
        ];
    }
}
