<?php

namespace App\Http\Resources\V1;

use App\Models\PrescriptionItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin PrescriptionItem
 */
class PrescriptionItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'medicine_name' => $this->medicine_name,
            'form' => $this->form,
            'strength' => $this->strength,
            'quantity' => $this->quantity,
            'unit' => $this->unit,
            'directions' => $this->directions,
            // Flagged so the pharmacy knows this requires in-person handling
            // and can never be routed to delivery.
            'is_controlled' => $this->is_controlled,
        ];
    }
}
