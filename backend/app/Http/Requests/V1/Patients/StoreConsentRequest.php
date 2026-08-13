<?php

namespace App\Http\Requests\V1\Patients;

use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * One consent decision, for one consent type.
 *
 * The shape of this body is the compliance control. Three properties matter:
 *
 *   1. `consent_type` is singular. There is no array, so no client can bundle
 *      three consents behind one tick -- DPPA 2019 requires consent to be
 *      specific, and a bundle is not specific.
 *   2. `affirmed` is REQUIRED and boolean. There is no default, because a
 *      default is the absence of an affirmative action, and the absence of an
 *      affirmative action is not consent. Omitting it is a 422, never a grant.
 *   3. `policy_version` is required and must match what the server is currently
 *      serving. A client showing stale wording collected consent to text we
 *      cannot reconstruct, which fails the "demonstrable" test outright.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
class StoreConsentRequest extends FormRequest
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
            'affirmed' => ['required', 'boolean'],
            'policy_version' => ['required', 'string', 'max:32'],

            // Recorded on the ConsentRecord so the author of the decision
            // survives in the evidence, not merely the fact of it.
            'granted_by' => ['sometimes', Rule::in(['patient', 'guardian'])],
            'guardian_name' => ['required_if:granted_by,guardian', 'string', 'max:200'],
            'guardian_relationship' => ['required_if:granted_by,guardian', 'string', 'max:60'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'affirmed.required' => 'Record the patient\'s decision explicitly: true to consent, false to decline.',
            'consent_type.in' => 'That is not a consent this clinic collects.',
        ];
    }
}
