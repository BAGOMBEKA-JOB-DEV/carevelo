<?php

namespace App\Services\Platform;

use App\Models\BreakGlassGrant;
use App\Models\TenantStatus;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Date;

/**
 * What a platform operator is allowed to know about a running system.
 *
 * Counts, states and one security assertion. No clinic is named, no patient is
 * counted, and nothing here narrows to a single tenant's activity — ordinary
 * support tooling diagnoses from metadata, and this is the whole of the
 * metadata it gets.
 *
 * @see docs/30-architecture/observability.md
 */
class PlatformHealth
{
    public function __construct(protected DatabaseManager $db) {}

    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        return [
            'checked_at' => Date::now()->toIso8601String(),
            'database' => $this->database(),
            'tenants' => $this->tenantCounts(),

            /*
             * Surfaced next to uptime on purpose. A rising number of live
             * grants means the metadata-based support tooling is INADEQUATE,
             * not that more access is needed, and a figure nobody sees is a
             * figure nobody acts on.
             */
            'break_glass' => [
                'active_grants' => BreakGlassGrant::query()->active()->count(),
            ],
        ];
    }

    /**
     * The connection role, and whether isolation is actually being enforced.
     *
     * The highest-consequence failure in this system is silent: PostgreSQL
     * exempts a table's owner, and any role holding BYPASSRLS, from row-level
     * security. Every policy then becomes inert while the application works
     * perfectly and protects nothing. It is reported here because the only
     * defence against a silent failure is to look at it deliberately.
     *
     * @return array<string, mixed>
     */
    protected function database(): array
    {
        $role = $this->db->connection()->selectOne(
            'select current_user as name,
                    (select rolbypassrls from pg_roles where rolname = current_user) as can_bypass,
                    (select rolsuper     from pg_roles where rolname = current_user) as is_super'
        );

        if (! is_object($role)) {
            return ['role' => null, 'isolation_enforced' => false];
        }

        /** @var object{name: string, can_bypass: bool, is_super: bool} $role */
        return [
            'role' => $role->name,
            'isolation_enforced' => ! $role->can_bypass && ! $role->is_super,
        ];
    }

    /**
     * How many clinics sit in each lifecycle state.
     *
     * Every state is present even at zero: a missing key reads as "no data"
     * rather than "none", and the difference matters when the state in question
     * is `offboarding`.
     *
     * @return array<string, int>
     */
    protected function tenantCounts(): array
    {
        $counts = [];

        foreach (TenantStatus::cases() as $status) {
            $counts[$status->value] = 0;
        }

        // The query builder rather than Eloquent: this is an aggregate over the
        // platform register, which carries no tenant_id and no RLS policy, and
        // hydrating every clinic to count them would be wasteful.
        /** @var array<int, object{status: string, total: int}> $rows */
        $rows = $this->db->connection()
            ->table('tenants')
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->get()
            ->all();

        foreach ($rows as $row) {
            $counts[$row->status] = (int) $row->total;
        }

        return $counts;
    }
}
