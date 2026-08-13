<?php

namespace App\Audit;

use App\Models\AuditEvent;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Date;

/**
 * Writes audit events.
 *
 * Events are written in the SAME TRANSACTION as the domain operation they
 * describe, so "the action succeeded but the audit event is missing" is not a
 * state the database permits. That is the difference between this and a log
 * line: a log may be lost without consequence, an audit event may not.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */
class AuditLog
{
    public function __construct(
        protected TenantContext $context,
        protected Request $request,
    ) {}

    /**
     * Record an event.
     *
     * @param  string  $action  noun.verb, past tense: 'prescription.issued'
     * @param  array<string, mixed>  $metadata  identifiers and outcomes only
     */
    public function record(
        string $action,
        ?string $subjectType = null,
        ?string $subjectId = null,
        array $metadata = [],
        ?Authenticatable $actor = null,
    ): AuditEvent {
        $actor ??= $this->request->user();

        return AuditEvent::create([
            'tenant_id' => $this->context->has() ? $this->context->currentOrFail() : null,
            'actor_type' => $this->actorType($actor),
            'actor_id' => $actor?->getAuthIdentifier(),
            'actor_role' => $this->actorRole($actor),
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'occurred_at' => Date::now(),
            'ip_address' => $this->request->ip(),
            'user_agent' => substr((string) $this->request->userAgent(), 0, 255),
            'metadata' => $this->scrub($metadata),
        ]);
    }

    protected function actorType(?Authenticatable $actor): string
    {
        if ($actor === null) {
            return 'system';
        }

        return class_basename($actor);
    }

    protected function actorRole(?Authenticatable $actor): ?string
    {
        if ($actor === null || ! method_exists($actor, 'getRoleNames')) {
            return null;
        }

        /** @var Collection<int, string> $roles */
        $roles = $actor->getRoleNames();

        return $roles->implode(',') ?: null;
    }

    /**
     * Drop anything that must never reach the audit log.
     *
     * A defence in depth against a careless caller: the audit log records THAT
     * something happened to WHICH record, never what the record said.
     *
     * @param  array<string, mixed>  $metadata
     * @return array<string, mixed>
     */
    protected function scrub(array $metadata): array
    {
        $forbidden = [
            'password', 'secret', 'token', 'api_key', 'secret_key',
            'diagnosis', 'notes', 'medicine', 'medicine_name', 'prescription_text',
            'given_name', 'family_name', 'patient_name', 'phone', 'email', 'address',
        ];

        return array_diff_key($metadata, array_flip($forbidden));
    }
}
