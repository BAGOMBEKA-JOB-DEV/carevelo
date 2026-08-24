<?php

namespace App\Http\Resources\V1\Concerns;

use App\Support\Notifications\ProhibitedContent;

/**
 * The read-path guard on an audit event's `metadata`.
 *
 * DELIBERATE DUPLICATION OF THE WRITE PATH, and it lives in one file so that the
 * duplication is exactly one copy rather than one per surface. App\Audit\AuditLog::scrub()
 * protects rows written from now on. This protects the READ of rows already in an
 * append-only table that nothing can go back and clean: the application role holds INSERT
 * and SELECT on audit_events and is denied UPDATE and DELETE, so a stray value written
 * before a key was added to the list below is in there permanently. The audit log is
 * retained for years and exported for compliance, which makes it the last place a stray
 * diagnosis should be allowed to survive.
 *
 * WHY IT IS A TRAIT AND NOT TWO PRIVATE METHODS. Two resources read this column now -- the
 * clinic administrator's own trail and the platform register -- and a denylist that exists
 * twice is a denylist that will be extended once. A term added here is caught on both
 * surfaces or on neither, which is the only honest state for a control like this.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */
trait ScrubsAuditMetadata
{
    /**
     * Metadata keys that are dropped whatever they contain.
     *
     * Mirrors App\Audit\AuditLog::scrub(). A key called `diagnosis` is a clinical field by
     * its name alone; there is no value it could hold that any endpoint should return.
     *
     * @var list<string>
     */
    private const REDACTED_KEYS = [
        'password', 'secret', 'token', 'api_key', 'secret_key',
        'diagnosis', 'notes', 'medicine', 'medicine_name', 'prescription_text',
        'given_name', 'family_name', 'patient_name', 'phone', 'email', 'address',
    ];

    /**
     * Identifiers and outcomes only, enforced rather than assumed.
     *
     * Values are checked against the same prohibited-content list the notification
     * templates are checked against -- one list, so a term added for an SMS is also caught
     * here. A match is replaced rather than dropped: the reader should see that a field
     * existed and was withheld, not be shown a payload that silently pretends to be
     * complete.
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
