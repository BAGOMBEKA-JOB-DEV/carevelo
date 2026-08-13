<?php

namespace App\Http\Requests\V1\Patients;

use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Withdrawal of one previously granted consent.
 *
 * Withdrawal is per type for the same reason granting is: a patient who no
 * longer wants remote consultations has not necessarily withdrawn consent to be
 * treated at all, and collapsing the two would either over-read or under-read
 * what they actually said.
 *
 * No policy version is accepted here. A withdrawal inherits the version and
 * text hash of the grant it revokes -- that is the text the patient is walking
 * back, and pinning the current wording instead would rewrite history.
 */
class WithdrawConsentRequest extends FormRequest
{
    use RejectsUnknownFields;

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
            'consent_type' => ['required', Rule::in(ConsentController::CONSENT_TYPES)],
        ];
    }
}
