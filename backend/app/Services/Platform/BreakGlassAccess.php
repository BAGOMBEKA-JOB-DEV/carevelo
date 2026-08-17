<?php

namespace App\Services\Platform;

use App\Audit\AuditLog;
use App\Models\BreakGlassGrant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * The doorway. Every read of tenant clinical data by a Carevelo operator goes
 * through here, and there is no second door.
 *
 * Three things happen on every single access, not once per grant:
 *
 *   1. the grant is re-checked — scope, time box, revocation, notification;
 *   2. an AuditEvent is written into the CLINIC'S OWN trail, so the controller
 *      can see what its processor read and when;
 *   3. the callback runs inside Tenancy::run(), because the platform routes
 *      bind no tenant and row-level security therefore shows nothing at all.
 *
 * Re-checking per access rather than per session is the point: a grant that
 * expires mid-investigation stops working mid-investigation.
 *
 * @see docs/50-security-compliance/rbac-matrix.md break-glass section
 */
class BreakGlassAccess
{
    public function __construct(
        protected AuditLog $audit,
        protected Tenancy $tenancy,
    ) {}

    /**
     * Run a callback under an active grant, auditing the access.
     *
     * @template TReturn
     *
     * @param  string  $scope  one of BreakGlassGrant::SCOPES; must match the granted scope
     * @param  ?string  $recordId  the record reached, recorded as an identifier only
     * @param  callable(BreakGlassGrant): TReturn  $callback
     * @return TReturn
     *
     * @throws AuthorizationException when no live grant covers this operator, tenant and scope
     */
    public function underGrant(
        User $operator,
        string $tenantId,
        string $scope,
        callable $callback,
        ?string $recordId = null,
    ): mixed {
        $grant = $this->activeGrant($operator, $tenantId, $scope);

        if ($grant === null) {
            // Deliberately uninformative about WHY. An operator who learns
            // "expired" versus "wrong scope" from a denial is being taught how
            // to shape a request that slips through; the answer is to request a
            // grant, which is visible to the clinic.
            throw new AuthorizationException(
                'No active break-glass grant covers this access. '
                .'Request one, stating a reason, a scope and a time box.'
            );
        }

        return $this->tenancy->run($tenantId, function () use ($grant, $operator, $scope, $recordId, $callback) {
            $this->audit->record(
                'break_glass.accessed',
                subjectType: 'BreakGlassGrant',
                subjectId: $grant->id,
                metadata: [
                    'operator_id' => $operator->id,
                    'scope' => $scope,
                    'record_id' => $recordId,
                ],
                actor: $operator,
            );

            return $callback($grant);
        });
    }

    /**
     * The live grant covering this operator, tenant and scope, if there is one.
     *
     * The scope comparison happens in PHP through permits() rather than in the
     * WHERE clause, so there is exactly one definition of "this grant permits
     * that" and no chance of a query drifting away from it.
     */
    public function activeGrant(User $operator, string $tenantId, string $scope): ?BreakGlassGrant
    {
        return BreakGlassGrant::query()
            ->active()
            ->where('operator_id', $operator->id)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('granted_at')
            ->get()
            ->first(fn (BreakGlassGrant $grant): bool => $grant->permits($scope));
    }
}
