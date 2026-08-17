<?php

namespace App\Http\Resources\V1;

use App\Models\AuditEvent;
use App\Support\Notifications\ProhibitedContent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One line of the evidence layer.
 *
 * An event records THAT something happened to WHICH record. Reconstructing what
 * the record said requires the record, under its own authorisation -- so every
 * field here is an identifier, an outcome or a timestamp.
 *
 * The metadata guard below is deliberate duplication of the scrub AuditLog
 * applies on write. The write-path scrub protects rows written from now on; this
 * one protects the read of rows already in an append-only table that nothing can
 * go back and clean. The audit log is retained for years and exported for
 * compliance, so it is the last place a stray diagnosis should be allowed to
 * survive.
 *
 * @see docs/50-security-compliance/audit-logging.md
 *
 * @mixin AuditEvent
 */
class AuditEventResource extends JsonResource
{
    /**
     * Metadata keys that are dropped whatever they contain.
     *
     * Mirrors App\Audit\AuditLog::scrub(). A key called `diagnosis` is a
     * clinical field by its name alone; there is no value it could hold that
     * this endpoint should return.
     *
     * @var list<string>
     */
    private const REDACTED_KEYS = [
        'password', 'secret', 'token', 'api_key', 'secret_key',
        'diagnosis', 'notes', 'medicine', 'medicine_name', 'prescription_text',
        'given_name', 'family_name', 'patient_name', 'phone', 'email', 'address',
    ];

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

    /**
     * Identifiers and outcomes only, enforced rather than assumed.
     *
     * Values are checked against the same prohibited-content list the
     * notification templates are checked against -- one list, so a term added
     * for an SMS is also caught here. A match is replaced rather than dropped:
     * the administrator should see that a field existed and was withheld, not
     * be shown a payload that silently pretends to be complete.
     *
     * @param  ?array<array-key, mixed>  $metadata
     * @return array<array-key, mixed>
     */
    private function safeMetadata(?array $metadata): array
    {
        if ($metadata === null) {
            return [];
        }

        $safe = [];

        foreach ($metadata as $key => $value) {
            if (in_array(mb_strtolower((string) $key), self::REDACTED_KEYS, true)) {
                continue;
            }

            if (is_array($value)) {
                $safe[$key] = $this->safeMetadata($value);

                continue;
            }

            $safe[$key] = is_scalar($value) && ! ProhibitedContent::isClean((string) $value)
                ? '[redacted]'
                : $value;
        }

        return $safe;
    }
}
