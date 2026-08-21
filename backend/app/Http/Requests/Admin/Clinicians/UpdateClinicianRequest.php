<?php

namespace App\Http\Requests\Admin\Clinicians;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\RegistrationBody;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Correcting a clinician's registration details, or completing them.
 *
 * This endpoint exists because of one line in the PRD: a clinician whose
 * registration number is not to hand is saved with `can_prescribe = false` and
 * prompted to complete it before prescribing. Without a way back in, that
 * prompt has nowhere to lead and the clinic is stuck with a colleague who can
 * be booked but can never prescribe.
 *
 * PATCH, so every field is `sometimes`: a partial update that blanked the
 * registration number because the client omitted it would silently strip a
 * clinician of the right to prescribe.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md, exception paths
 */
class UpdateClinicianRequest extends FormRequest
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
            'registration_body' => ['sometimes', 'string', Rule::enum(RegistrationBody::class)],
            'registration_number' => ['sometimes', 'nullable', 'string', 'max:100'],
            'practising_licence_expires_at' => ['sometimes', 'nullable', 'date'],
            'specialty' => ['sometimes', 'nullable', 'string', 'max:200'],
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
            'user_id.prohibited' => 'A clinical profile cannot be moved to a different colleague. '
                .'Every consultation and prescription already written points at this one.',
        ];
    }
}
