<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\TenantStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The platform's lever on a clinic: its lifecycle state and its trial.
 *
 * COMMERCIAL fields only. Branding, contact details, services and staff belong
 * to the clinic and are changed through the clinic's own admin endpoints — a
 * platform operator editing a clinic's brand is a support incident, not a
 * feature.
 *
 * Suspension is likewise commercial and never clinical. It blocks staff
 * sign-in; it does not stop a patient reading their own records or a delivery
 * already in flight, and nothing in this request could make it do so.
 *
 * @see docs/20-domain/state-machines.md tenant lifecycle
 */
class UpdateTenantRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** TenantPolicy holds the default-deny answer; the controller consults it. */
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
            // Whether the move is legal is TenantStatus's decision, not a
            // validation rule's: a state machine with its transitions restated
            // in a form request has two definitions and one of them will drift.
            'status' => ['sometimes', Rule::enum(TenantStatus::class)],
            'trial_ends_at' => ['sometimes', 'nullable', 'date'],
        ];
    }

    public function status(): ?TenantStatus
    {
        $status = $this->validated('status');

        return is_string($status) ? TenantStatus::from($status) : null;
    }
}
