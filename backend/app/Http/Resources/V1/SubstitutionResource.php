<?php

namespace App\Http\Resources\V1;

use App\Models\Substitution;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A proposal to dispense something other than what was prescribed.
 *
 * The proposed medicine name IS published here, and that is correct: this
 * endpoint is behind the policy, and a clinician cannot decide on a
 * substitution without knowing what is being proposed. The same name is
 * deliberately absent from the broadcast frame and from the audit event, which
 * are seen by more people than this response is.
 *
 * `proposed_by` and `decided_by` are the user ids of tenant staff. The decision
 * is always a named person's -- there is no auto-approval to attribute it to.
 *
 * @mixin Substitution
 */
class SubstitutionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'dispense_order_id' => $this->dispense_order_id,
            'prescription_item_id' => $this->prescription_item_id,
            'proposed_medicine_name' => $this->proposed_medicine_name,
            'reason' => $this->reason,
            'status' => $this->status->value,
            'proposed_by' => $this->proposed_by,
            'proposed_at' => $this->proposed_at?->toIso8601String(),
            'decided_by' => $this->decided_by,
            'decided_at' => $this->decided_at?->toIso8601String(),
        ];
    }
}
