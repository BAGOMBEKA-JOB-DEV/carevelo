<?php

namespace App\Http\Requests\V1\Prescriptions;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The prescribing form.
 *
 * Shape only. The two hard preconditions on prescribing — the clinician's
 * right to prescribe, and the consultation outcome — are enforced by
 * Prescription::issue(), never here: they are domain rules that must hold for
 * every caller, not validation the API layer happens to apply.
 *
 * There is deliberately no clinician_id field. A prescription is the act of
 * the authenticated clinician; accepting the identity from the body would let
 * one clinician sign in another's name.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md section 6
 */
class StorePrescriptionRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * Authorisation is the controller's job: policies are default-deny and are
     * consulted with $this->authorize() so a denial renders as 403, not 422.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'consultation_id' => ['required', 'string', 'ulid'],

            // A prescription with no items is not a clinical document.
            'items' => ['required', 'array', 'min:1'],
            'items.*.medicine_name' => ['required', 'string', 'max:255'],
            'items.*.form' => ['nullable', 'string', 'max:255'],
            'items.*.strength' => ['nullable', 'string', 'max:255'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'items.*.unit' => ['nullable', 'string', 'max:255'],
            'items.*.directions' => ['required', 'string', 'max:2000'],

            // Controlled items are flagged by the clinician. Carevelo does not
            // classify medicines — doing so would be a clinical judgement it
            // has no standing to make.
            'items.*.is_controlled' => ['sometimes', 'boolean'],
        ];
    }

    public function consultationId(): string
    {
        return (string) $this->validated('consultation_id');
    }

    /**
     * @return list<array{
     *     medicine_name: string,
     *     form: ?string,
     *     strength: ?string,
     *     quantity: int,
     *     unit: ?string,
     *     directions: string,
     *     is_controlled: bool,
     * }>
     */
    public function items(): array
    {
        /** @var array<int, array<string, mixed>> $items */
        $items = $this->validated('items');

        return array_values(array_map(static fn (array $item): array => [
            'medicine_name' => (string) $item['medicine_name'],
            'form' => isset($item['form']) ? (string) $item['form'] : null,
            'strength' => isset($item['strength']) ? (string) $item['strength'] : null,
            'quantity' => (int) $item['quantity'],
            'unit' => isset($item['unit']) ? (string) $item['unit'] : null,
            'directions' => (string) $item['directions'],
            'is_controlled' => (bool) ($item['is_controlled'] ?? false),
        ], $items));
    }
}
