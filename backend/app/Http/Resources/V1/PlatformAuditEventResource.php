<?php

namespace App\Http\Resources\V1;

use App\Http\Resources\V1\Concerns\ScrubsAuditMetadata;
use App\Models\AuditEvent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One line of the evidence layer, as a CAREVELO OPERATOR reads it.
 *
 * ============================================================
 * THIS IS NOT AuditEventResource WITHOUT THE TENANT SCOPE
 * ============================================================
 *
 * docs/50-security-compliance/audit-logging.md, § Access:
 *
 *     Platform roles | Platform events and **metadata only** for tenant events
 *
 * Two projections of one table, and the whole reason this class exists rather than the
 * platform endpoint reusing the clinic's resource. A clinic administrator reading their own
 * trail is the CONTROLLER reading their own records; a platform operator reading the same
 * row is the PROCESSOR reading somebody else's. The rows are identical and what may be
 * shown of them is not.
 *
 * ============================================================
 * WHAT A TENANT-OWNED ROW KEEPS: THE ENVELOPE
 * ============================================================
 *
 * That something happened, to which clinic, by which actor, of what kind, and when:
 * `tenant_id`, `action`, `actor_type`, `actor_id`, `actor_role`, `subject_type`,
 * `occurred_at`, `request_id`. That is enough to answer the questions this surface exists
 * to answer -- did that happen, when, who did it, is this actor's read volume the
 * insider-exfiltration signature, are authentication failures at this clinic the shape of
 * credential stuffing -- and it is the list the specification calls metadata.
 *
 * ============================================================
 * WHAT A TENANT-OWNED ROW LOSES, AND WHY EACH ONE
 * ============================================================
 *
 * `metadata` -- dropped WHOLE, not scrubbed. It is the one unbounded field on the table:
 * free-form jsonb whose contents are filtered on write by KEY NAME, which is a denylist,
 * and denylists do not prove absence. On a table that nothing can UPDATE or DELETE, a value
 * written before a key was added to that list is in there permanently. The clinic's own
 * administrator sees it scrubbed because it is their record and their controller
 * obligation; a processor does not get the benefit of the doubt on a field that could hold
 * anything.
 *
 * `subject_id` -- WHICH record. `subject_type` says a consultation was read; `subject_id`
 * says which one, and a page of them is a map of a clinic's patient population built out
 * of the log that exists to protect it. An operator who genuinely needs record-level detail
 * asks for a break-glass grant, which is reason-recorded, time-boxed, tenant-notified and
 * audited. THIS REGISTER STOPS EXACTLY WHERE BREAK-GLASS STARTS, and that boundary is the
 * design rather than an omission: a support surface that quietly answers record-level
 * questions is a support surface that has replaced the control.
 *
 * `ip_address` and `user_agent` -- the clinic's own staff, where they were and what they
 * were holding. Personal data about somebody else's employees, of which that clinic is the
 * controller, and not needed to see THAT something happened. It stays in the clinic's own
 * trail, where the administrator investigating their own staff reads it.
 *
 * ============================================================
 * A PLATFORM ROW (null tenant_id) IS RETURNED IN FULL
 * ============================================================
 *
 * Break-glass grants, tenant provisioning and suspension, TOTP enrolments, platform
 * sign-ins. These belong to Carevelo, name no clinic's records, and this register is the
 * review surface for them -- a grant whose stated reason could not be read back would make
 * the periodic review of grants impossible. Their `metadata` still goes through
 * ScrubsAuditMetadata on the way out: nothing clinical can be written with no tenant bound,
 * and "cannot happen" is not a reason to skip a guard that costs one function call.
 *
 * `projection` NAMES WHICH OF THE TWO THIS ROW IS, so the screen can say a field was
 * withheld rather than render a blank cell that reads as "nothing happened". A null in
 * `subject_id` on a withheld row and a null on a row that genuinely had no subject are the
 * same JSON, and the difference matters to somebody investigating.
 *
 * @see docs/50-security-compliance/audit-logging.md
 * @see docs/50-security-compliance/rbac-matrix.md § Administration
 *
 * @mixin AuditEvent
 */
class PlatformAuditEventResource extends JsonResource
{
    use ScrubsAuditMetadata;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        // The projection is chosen by the ROW, not by the request and not by the reader's
        // role. There is no parameter that widens it and no platform role that carries a
        // wider one, so there is no code path in which a tenant-owned row is serialised
        // with its payload attached.
        $ownedByAClinic = $this->tenant_id !== null;

        return [
            'id' => $this->id,
            // Null on a platform event, which is what makes it one. The screen reads this
            // to say "Carevelo" rather than naming a clinic.
            'tenant_id' => $this->tenant_id,
            'action' => $this->action,
            'actor_type' => $this->getAttribute('actor_type'),
            'actor_id' => $this->getAttribute('actor_id'),
            'actor_role' => $this->getAttribute('actor_role'),
            // The KIND of thing acted on, never which one. See the class docblock.
            'subject_type' => $this->getAttribute('subject_type'),
            'subject_id' => $ownedByAClinic ? null : $this->getAttribute('subject_id'),
            'occurred_at' => $this->occurred_at->toIso8601String(),
            'ip_address' => $ownedByAClinic ? null : $this->getAttribute('ip_address'),
            'user_agent' => $ownedByAClinic ? null : $this->getAttribute('user_agent'),
            // Kept on both projections. It holds nothing about anybody -- it is the join
            // key to the application logs, and an operator diagnosing an incident from
            // metadata alone needs the half of the story the logs hold.
            'request_id' => $this->getAttribute('request_id'),
            'metadata' => $ownedByAClinic ? null : $this->safeMetadata($this->metadata),
            'projection' => $ownedByAClinic ? 'metadata_only' : 'full',
        ];
    }
}
