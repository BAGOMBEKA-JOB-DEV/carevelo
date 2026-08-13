<?php

namespace App\Http\Requests\V1\Prescriptions;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cancellation is how a prescription is corrected, so the reason is mandatory.
 *
 * The document has left the building and may already be on someone's phone.
 * A cancellation with no recorded reason leaves the next reader — the
 * pharmacist, the patient, an auditor — unable to tell a transcription slip
 * from a clinical reversal.
 */
class CancelPrescriptionRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // 255 matches the column: a reason that silently truncates is worse
        // than one the clinician is asked to shorten.
        return [
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ];
    }

    public function reason(): string
    {
        return trim((string) $this->validated('reason'));
    }
}
