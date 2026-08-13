<?php

namespace App\Http\Resources\V1;

use App\Models\ConsentRecord;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * One immutable consent decision.
 *
 * `policy_version` and `policy_text_hash` are exposed on purpose. They are what
 * make the record verifiable by someone outside the system: a patient, a
 * clinic's own auditor or the regulator can take the hash, re-render the
 * versioned policy and confirm the wording was not quietly changed afterwards.
 *
 * `ip_address` and `user_agent` are deliberately withheld. They exist for
 * investigating a disputed decision, not for routine display.
 *
 * @mixin ConsentRecord
 */
class ConsentRecordResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        // Through getAttribute() rather than the magic property: the cast is
        // declared on the model, but the column type alone says "string", and
        // reading it as one would serialise a raw timestamp instead of ISO 8601.
        $occurredAt = $this->getAttribute('occurred_at');

        return [
            'id' => $this->id,
            'patient_id' => $this->patient_id,
            'consent_type' => $this->consent_type,
            'action' => $this->action,
            'policy_version' => $this->policy_version,
            'policy_text_hash' => $this->policy_text_hash,
            'granted_by' => $this->granted_by,
            'guardian_name' => $this->guardian_name,
            'guardian_relationship' => $this->guardian_relationship,
            'occurred_at' => $occurredAt instanceof Carbon ? $occurredAt->toIso8601String() : null,
        ];
    }
}
