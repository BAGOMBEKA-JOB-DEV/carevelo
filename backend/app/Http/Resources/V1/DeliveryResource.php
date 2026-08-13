<?php

namespace App\Http\Resources\V1;

use App\Models\Delivery;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A delivery, as a DISPATCHER sees it.
 *
 * Still carries no diagnosis or prescription detail -- a Delivery holds none.
 * The difference from the rider view is the dispatch metadata, not clinical
 * content.
 *
 * @mixin Delivery
 */
class DeliveryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'dispense_order_id' => $this->dispense_order_id,
            'rider_id' => $this->rider_id,
            'recipient_name' => $this->recipient_name,
            'recipient_phone' => $this->recipient_phone,
            'address_text' => $this->address_text,
            'district' => $this->district,
            'landmark' => $this->landmark,
            'status' => $this->status->value,
            'assigned_at' => $this->assigned_at?->toIso8601String(),
            'delivered_at' => $this->delivered_at?->toIso8601String(),
            'failure_reason' => $this->failure_reason,
        ];
    }
}
