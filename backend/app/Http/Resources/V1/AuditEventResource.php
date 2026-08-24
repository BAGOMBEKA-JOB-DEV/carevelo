<?php

namespace App\Http\Resources\V1;

use App\Http\Resources\V1\Concerns\ScrubsAuditMetadata;
use App\Models\AuditEvent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One line of the evidence layer, as the clinic that owns it reads it.
 *
 * An event records THAT something happened to WHICH record. Reconstructing what the record
 * said requires the record, under its own authorisation -- so every field here is an
 * identifier, an outcome or a timestamp.
 *
 * The metadata guard is deliberate duplication of the scrub AuditLog applies on write, and
 * it now lives in ScrubsAuditMetadata because a second surface reads this column: see
 * PlatformAuditEventResource, which serves a Carevelo operator a strictly narrower
 * projection of the same row. A denylist that exists twice is a denylist that gets extended
 * once.
 *
 * @see docs/50-security-compliance/audit-logging.md
 *
 * @mixin AuditEvent
 */
class AuditEventResource extends JsonResource
{
    use ScrubsAuditMetadata;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action,
            'actor_type' => $this->getAttribute('actor_type'),
            'actor_id' => $this->getAttribute('actor_id'),
            'actor_role' => $this->getAttribute('actor_role'),
            'subject_type' => $this->getAttribute('subject_type'),
            'subject_id' => $this->getAttribute('subject_id'),
            'occurred_at' => $this->occurred_at->toIso8601String(),
            'ip_address' => $this->getAttribute('ip_address'),
            'user_agent' => $this->getAttribute('user_agent'),
            // The join key to the application logs: audit says what happened,
            // logs say how it went technically.
            'request_id' => $this->getAttribute('request_id'),
            'metadata' => $this->safeMetadata($this->metadata),
        ];
    }
}
