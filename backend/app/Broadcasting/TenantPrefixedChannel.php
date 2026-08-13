<?php

namespace App\Broadcasting;

use App\Audit\AuditLog;
use App\Models\User;
use App\Tenancy\Tenancy;

/**
 * The two checks every channel subscription must pass.
 *
 *   1. the channel's tenant prefix matches the tenant of the AUTHENTICATED
 *      SESSION — catching a user of clinic A asking for clinic B's channel;
 *   2. the same policy the REST API runs for the same data — catching a user
 *      of the right clinic with the wrong role.
 *
 * Both are required, and a channel name is not a permission. The template
 * method is final so a subclass cannot implement one check and forget the
 * other: subclasses supply only the policy half.
 *
 * The tenant in the channel name is CLIENT INPUT. It is compared against the
 * session tenant and never used to establish context — row-level security is
 * bound to the session tenant, so a lookup performed while authorising a
 * channel cannot reach the tenant the client asked for.
 *
 * @see docs/30-architecture/realtime-broadcasting.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
abstract class TenantPrefixedChannel
{
    public function __construct(
        protected Tenancy $tenancy,
        protected AuditLog $audit,
    ) {}

    /**
     * Authorise a subscription.
     *
     * Called by the broadcaster with the channel-name placeholders in order,
     * so the signature is variadic: `{tenantId}` first, then whatever subject
     * the pattern names.
     */
    final public function join(User $user, string $tenantId, string ...$parameters): bool
    {
        $sessionTenantId = $user->tenant_id;

        if ($sessionTenantId === null || $sessionTenantId !== $tenantId) {
            // Either a bug or an attack, and both deserve a record. Same
            // reasoning as the session/host mismatch in ResolveTenant.
            $this->auditMismatch($user, $sessionTenantId, $tenantId);

            return false;
        }

        // Subscription is authorised once, at subscribe time, so a deactivated
        // account must fail here as well as at the next request. Reconnects
        // re-authorise every channel, which is what makes that sufficient.
        if (! $user->is_active) {
            return false;
        }

        return $this->tenancy->run(
            $sessionTenantId,
            fn (): bool => $this->authorise($user, ...$parameters),
        );
    }

    /**
     * The pattern this channel is registered under.
     *
     * Recorded on a refused subscription instead of the raw string the client
     * sent, which is unvalidated input.
     */
    abstract public function pattern(): string;

    /**
     * The policy half of the decision, run with RLS bound to the user's tenant.
     *
     * @param  string  ...$parameters  the channel-name placeholders after the tenant
     */
    abstract protected function authorise(User $user, string ...$parameters): bool;

    /**
     * The subject identifier a channel names, if the client supplied one.
     *
     * @param  array<array-key, string>  $parameters
     */
    protected function subjectId(array $parameters): ?string
    {
        return $parameters[0] ?? null;
    }

    /**
     * Record a refused subscription whose tenant prefix did not match.
     *
     * Attributed to the user's OWN tenant, not the one they asked for: the
     * requested tenant is client input, and writing an audit row into a clinic
     * named by an attacker would let them post entries in someone else's trail.
     * A platform user has no tenant, so the row lands as a platform row.
     */
    private function auditMismatch(User $user, ?string $sessionTenantId, string $requestedTenantId): void
    {
        $record = fn () => $this->audit->record(
            'broadcast.tenant_mismatch',
            subjectType: 'broadcast_channel',
            subjectId: null,
            metadata: [
                'channel' => $this->pattern(),
                // Truncated: a channel segment is a ULID, and an unbounded
                // string from the wire has no business in the audit log.
                'requested_tenant_id' => substr($requestedTenantId, 0, 64),
                'session_tenant_id' => $sessionTenantId,
            ],
            actor: $user,
        );

        if ($sessionTenantId === null) {
            $record();

            return;
        }

        $this->tenancy->run($sessionTenantId, $record);
    }
}
