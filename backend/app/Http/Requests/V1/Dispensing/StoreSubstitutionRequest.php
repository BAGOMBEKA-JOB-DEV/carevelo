<?php

namespace App\Http\Requests\V1\Dispensing;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A pharmacist PROPOSING a substitute.
 *
 * Proposing only. There is deliberately no `status` field and no
 * `approve_immediately` flag: a substitution takes effect on a clinician's
 * approval or not at all, and the shape of this request is one of the places
 * that is made structurally true rather than merely checked.
 *
 * The reason is mandatory. It is the entire basis on which a clinician who is
 * not standing in the pharmacy decides, and "out of stock" versus "the
 * strength we hold is different" are very different clinical questions.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md — out of stock
 */
class StoreSubstitutionRequest extends FormRequest
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
            'prescription_item_id' => ['required', 'string', 'ulid'],
            'proposed_medicine_name' => ['required', 'string', 'max:255'],
            'reason' => ['required', 'string', 'max:2000'],
        ];
    }

    public function prescriptionItemId(): string
    {
        return (string) $this->validated('prescription_item_id');
    }

    public function proposedMedicineName(): string
    {
        return (string) $this->validated('proposed_medicine_name');
    }

    public function reason(): string
    {
        return (string) $this->validated('reason');
    }
}
