<?php

namespace App\Http\Resources\V1;

use App\Models\DispenseOrder;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The pharmacy's work item.
 *
 * Distinct from PrescriptionResource on purpose: what was PRESCRIBED and what
 * was DISPENSED are different facts, and an order that flattened the two would
 * make a substitution or a partial fill invisible after the event.
 *
 * The prescription is exposed only when the caller explicitly loaded it, so the
 * queue listing stays free of medicine names -- a pharmacist scanning a queue
 * needs references and states, and the detail view is where the contents
 * belong.
 *
 * @mixin DispenseOrder
 */
class DispenseOrderResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'status' => $this->status->value,
            'prescription_id' => $this->prescription_id,
            'patient_id' => $this->patient_id,

            // Dispensing is always attributable to a NAMED pharmacist of the
            // tenant (NDPA Act Cap 206). Null until it has actually happened.
            'pharmacist_id' => $this->pharmacist_id,
            'dispensed_at' => $this->dispensed_at?->toIso8601String(),

            'fulfilment' => $this->fulfilment,
            'subtotal' => Money::of($this->subtotal_minor)->jsonSerialize(),
            'delivery_fee' => Money::of($this->delivery_fee_minor)->jsonSerialize(),
            'total' => Money::of($this->total_minor)->jsonSerialize(),

            'rejection_reason' => $this->rejection_reason,

            'items' => DispenseItemResource::collection($this->whenLoaded('items')),
            'substitutions' => SubstitutionResource::collection($this->whenLoaded('substitutions')),
            'prescription' => PrescriptionResource::make($this->whenLoaded('prescription')),
        ];
    }
}
