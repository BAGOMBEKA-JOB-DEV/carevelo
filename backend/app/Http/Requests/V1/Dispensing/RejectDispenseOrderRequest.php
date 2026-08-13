<?php

namespace App\Http\Requests\V1\Dispensing;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The pharmacy declining to fill an order.
 *
 * A reason is required. An order that simply stops, with no record of why the
 * pharmacy would not fill it, leaves the prescribing clinician guessing and the
 * patient with nothing to be told.
 *
 * The reason stays on the record. It is not copied into the audit event or any
 * notification, because a pharmacist explaining a refusal will naturally name
 * the medicine.
 */
class RejectDispenseOrderRequest extends FormRequest
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
            'reason' => ['required', 'string', 'max:255'],
        ];
    }

    public function reason(): string
    {
        return (string) $this->validated('reason');
    }
}
