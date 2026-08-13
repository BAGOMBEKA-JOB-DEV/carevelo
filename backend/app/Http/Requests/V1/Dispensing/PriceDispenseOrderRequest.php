<?php

namespace App\Http\Requests\V1\Dispensing;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Pricing an order at the clinic's own prices.
 *
 * Carevelo does not price medicines and takes no margin on one. Every amount
 * here is the clinic's, typed by the clinic's own pharmacist, and the platform
 * only records it.
 *
 * Prices are integer minor units. There is no field that accepts a decimal
 * anywhere in this payload, because the moment a fee split or a percentage
 * lands on a fractional amount the rounding becomes a financial defect.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md section 2
 */
class PriceDispenseOrderRequest extends FormRequest
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
            'items' => ['required', 'array', 'min:1'],
            'items.*.prescription_item_id' => ['required', 'string', 'ulid'],

            // What is actually going in the bag, which may differ from what was
            // prescribed. Recorded separately from the prescription so both
            // facts survive.
            'items.*.medicine_name_dispensed' => ['required', 'string', 'max:255'],
            'items.*.quantity_dispensed' => ['required', 'integer', 'min:0'],
            'items.*.unit_price_minor' => ['required', 'integer', 'min:0'],

            // Set when this line is being filled with an APPROVED substitute.
            // The controller refuses the id if the substitution is not approved
            // and not for this order -- shape here, decision there.
            'items.*.substitution_id' => ['sometimes', 'nullable', 'string', 'ulid'],

            // Partial fill. An unfulfilled line must say why, so the clinician
            // can later see which item the patient never received rather than
            // finding a silent gap.
            'items.*.is_fulfilled' => ['sometimes', 'boolean'],
            'items.*.unfulfilled_reason' => [
                'required_if:items.*.is_fulfilled,false', 'nullable', 'string', 'max:255',
            ],

            'delivery_fee_minor' => ['sometimes', 'integer', 'min:0'],
        ];
    }

    /**
     * @return list<array{
     *     prescription_item_id: string,
     *     medicine_name_dispensed: string,
     *     quantity_dispensed: int,
     *     unit_price_minor: int,
     *     substitution_id: ?string,
     *     is_fulfilled: bool,
     *     unfulfilled_reason: ?string,
     * }>
     */
    public function items(): array
    {
        /** @var array<int, array<string, mixed>> $items */
        $items = $this->validated('items');

        return array_values(array_map(static function (array $item): array {
            $substitutionId = $item['substitution_id'] ?? null;
            $reason = $item['unfulfilled_reason'] ?? null;

            return [
                'prescription_item_id' => (string) $item['prescription_item_id'],
                'medicine_name_dispensed' => (string) $item['medicine_name_dispensed'],
                'quantity_dispensed' => (int) $item['quantity_dispensed'],
                'unit_price_minor' => (int) $item['unit_price_minor'],
                'substitution_id' => is_string($substitutionId) ? $substitutionId : null,
                'is_fulfilled' => (bool) ($item['is_fulfilled'] ?? true),
                'unfulfilled_reason' => is_string($reason) ? $reason : null,
            ];
        }, $items));
    }

    public function deliveryFeeMinor(): int
    {
        $fee = $this->validated('delivery_fee_minor');

        return is_numeric($fee) ? (int) $fee : 0;
    }
}
