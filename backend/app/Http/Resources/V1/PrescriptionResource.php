<?php

namespace App\Http\Resources\V1;

use App\Models\Prescription;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A prescription.
 *
 * The clinician's name and registration number come from the SNAPSHOT taken at
 * issue, not from a join -- if the clinician later leaves the tenant, the
 * historical document must still show what was on it.
 *
 * Carevelo appears nowhere as issuer.
 *
 * @mixin Prescription
 */
class PrescriptionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status->value,
            'issued_at' => $this->issued_at?->toIso8601String(),
            'issued_by' => [
                'name' => $this->clinician_name_snapshot,
                'registration_number' => $this->clinician_registration_snapshot,
                'registration_body' => $this->registration_body_snapshot,
            ],
            'items' => PrescriptionItemResource::collection($this->whenLoaded('items')),
            'supersedes_prescription_id' => $this->supersedes_prescription_id,
        ];
    }
}
