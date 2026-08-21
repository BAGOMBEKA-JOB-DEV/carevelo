<?php

namespace App\Http\Requests\Admin\Clinicians;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\RegistrationBody;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Recording a colleague's CLINICAL profile.
 *
 * The staff invitation created a person with a role. This is the other half:
 * the registration details without which that person cannot prescribe, and
 * without which -- because availability is generated per Clinician row -- the
 * clinic has nobody to book.
 *
 * `user_id` is prohibited rather than absent. The clinician is named by the
 * path, resolved against the administrator's own tenant, and a body field would
 * be a second way to say the same thing that nothing then checks. `tenant_id`
 * is prohibited for the reason it is everywhere else: tenancy comes from the
 * host or the session and never from a payload.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 6
 * @see docs/20-domain/domain-model.md
 */
class StoreClinicianRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Authorisation is the controller's explicit administrator check. */
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
            'registration_body' => ['required', 'string', Rule::enum(RegistrationBody::class)],

            /*
             * `present`, not `required`: the empty value is legitimate here.
             *
             * The PRD names the case directly -- a clinician whose registration
             * number is not to hand is saved with prescribing off and prompted
             * to complete it later -- and a clinic that cannot record the
             * colleague at all until someone finds a certificate simply does not
             * finish onboarding.
             *
             * But it must be SAID rather than omitted. Leaving the key out of
             * the payload is how a client discovers weeks later that a number it
             * thought it sent was never stored; sending it empty is a decision
             * the administrator made.
             */
            'registration_number' => ['present', 'nullable', 'string', 'max:100'],

            'practising_licence_expires_at' => ['sometimes', 'nullable', 'date'],
            'specialty' => ['sometimes', 'nullable', 'string', 'max:200'],

            /*
             * Defaults to false, which is the safe direction. The single most
             * important flag in the system is not one to switch on by omission.
             */
            'can_prescribe' => ['sometimes', 'boolean'],

            'tenant_id' => ['prohibited'],
            'user_id' => ['prohibited'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'tenant_id.prohibited' => 'A clinician belongs to exactly one clinic, and it is this one. '
                .'Someone practising at two clinics has two accounts.',
            'user_id.prohibited' => 'The colleague is named by the URL, not by the body.',
        ];
    }
}
