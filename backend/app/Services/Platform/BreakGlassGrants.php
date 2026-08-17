<?php

namespace App\Services\Platform;

use App\Audit\AuditLog;
use App\Models\BreakGlassGrant;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * Issues break-glass grants.
 *
 * Issuing and notifying happen in ONE transaction. A grant that exists while
 * the clinic has not been told is the exact failure this control is meant to
 * make impossible, so the two facts cannot come apart: if the notification
 * write fails, the grant does not exist.
 *
 * @see docs/50-security-compliance/rbac-matrix.md break-glass section
 */
class BreakGlassGrants
{
    public function __construct(
        protected AuditLog $audit,
        protected Tenancy $tenancy,
        protected DatabaseManager $db,
    ) {}

    public function issue(
        User $operator,
        Tenant $tenant,
        string $reason,
        string $scope,
        Carbon $expiresAt,
    ): BreakGlassGrant {
        return $this->db->connection()->transaction(function () use ($operator, $tenant, $reason, $scope, $expiresAt) {
            $grant = BreakGlassGrant::create([
                'tenant_id' => $tenant->id,
                'operator_id' => $operator->id,
                'reason' => $reason,
                'scope' => $scope,
                'granted_at' => Date::now(),
                'expires_at' => $expiresAt,
            ]);

            // Platform-level event: no tenant is bound on these routes, so this
            // row carries a null tenant_id and lives in the platform trail. The
            // reason text is NOT copied into it -- an operator types free text
            // there, and free text in an audit event is how clinical content
            // ends up somewhere it is retained permanently.
            $this->audit->record(
                'break_glass.granted',
                subjectType: 'BreakGlassGrant',
                subjectId: $grant->id,
                metadata: [
                    'tenant_id' => $tenant->id,
                    'operator_id' => $operator->id,
                    'scope' => $scope,
                    'expires_at' => $expiresAt->toIso8601String(),
                ],
                actor: $operator,
            );

            $this->notifyTenant($grant, $operator);

            return $grant->refresh();
        });
    }

    /**
     * Tell the clinic.
     *
     * The notification is written into the CLINIC'S OWN audit trail, which is
     * the surface its administrator already reads (GET /v1/audit-events) and the
     * one retained permanently for tenant-lifecycle and break-glass events. It
     * is not an SMS: the notification catalogue is a closed list of
     * patient-facing messages, and a support event does not belong on a handset.
     *
     * Row-level security is unbound on the platform routes, so reaching the
     * clinic's trail at all requires entering its context explicitly.
     */
    protected function notifyTenant(BreakGlassGrant $grant, User $operator): void
    {
        $this->tenancy->run($grant->tenant_id, fn () => $this->audit->record(
            'break_glass.tenant_notified',
            subjectType: 'BreakGlassGrant',
            subjectId: $grant->id,
            metadata: [
                'operator_id' => $operator->id,
                'scope' => $grant->scope,
                'expires_at' => $grant->expires_at->toIso8601String(),
            ],
            actor: $operator,
        ));

        $grant->tenant_notified_at = Date::now();
        $grant->save();
    }
}
