<?php

namespace App\Http\Resources\V1;

use App\Models\DispenseItem;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What was actually handed over, at what price.
 *
 * A deliberately explicit field list rather than the whole row: this is a
 * clinical record read by pharmacy and clinic staff, and "minimum necessary"
 * is a DPPA 2019 obligation rather than a preference. A new column added to
 * the table must be published here on purpose, never by default.
 *
 * `is_fulfilled` and `unfulfilled_reason` are what make a partial fill legible
 * later -- the clinician needs to see which item the patient never received.
 *
 * @mixin DispenseItem
 */
class DispenseItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'prescription_item_id' => $this->prescription_item_id,
            'medicine_name_dispensed' => $this->medicine_name_dispensed,
            'quantity_dispensed' => $this->quantity_dispensed,
            'unit_price' => Money::of($this->unit_price_minor)->jsonSerialize(),
            // Present when this item was dispensed against an APPROVED
            // substitution, so the substitute is traceable back to the
            // clinician who allowed it.
            'substitution_id' => $this->substitution_id,
            'is_fulfilled' => $this->is_fulfilled,
            'unfulfilled_reason' => $this->unfulfilled_reason,
        ];
    }
}
