<?php

namespace App\Providers;

use App\Tenancy\Tenancy;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;

class TenancyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One context per request/worker cycle. Singleton so middleware, jobs
        // and the Tenancy service all see the same resolved tenant.
        $this->app->singleton(TenantContext::class);
        $this->app->singleton(Tenancy::class);
    }

    public function boot(): void
    {
        $this->registerSchemaMacros();
    }

    /**
     * Schema macros for row-level security.
     *
     * Tenant isolation is a legal requirement, not a feature: each clinic is a
     * separate data controller of special-category health data, and a
     * cross-tenant leak is a notifiable breach affecting two controllers at
     * once.
     *
     * The control is PostgreSQL RLS, not Eloquent global scopes. Scopes are
     * bypassed by DB::table(), raw SQL, withoutGlobalScopes() and — most
     * dangerously, because it looks entirely normal — Model::find($id). RLS
     * defeats all four because the database does not care which PHP construct
     * produced the query.
     *
     * These are macros so that enabling isolation is one call. Every element is
     * load-bearing, and applying some but not all yields a table that looks
     * protected and is not.
     *
     * @see docs/30-architecture/multi-tenancy.md
     * @see docs/70-decisions/0002-postgresql-rls-shared-schema-tenancy.md
     */
    protected function registerSchemaMacros(): void
    {
        Schema::macro('enableTenantIsolation', function (string $table): void {
            $setting = Tenancy::TENANT_SETTING;

            // ENABLE turns RLS on. FORCE additionally applies it to the table
            // OWNER — without it, the migrator role reads every tenant's rows.
            //
            // A consequence worth knowing: with FORCE on, seeders and data
            // migrations must also run inside Tenancy::run(). That is correct.
            // Writing tenant data without knowing the tenant is a bug.
            DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
            DB::statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");

            // USING filters reads. WITH CHECK blocks writes that would place a
            // row in another tenant — without it, an attacker could insert into
            // a tenant they cannot read.
            //
            // current_setting(..., true) returns NULL when unset, so the
            // comparison yields NULL, so no rows match. Unset context means
            // zero rows, never all rows: fail-closed by construction.
            DB::statement(
                "CREATE POLICY tenant_isolation ON {$table} ".
                "USING (tenant_id = current_setting('{$setting}', true)) ".
                "WITH CHECK (tenant_id = current_setting('{$setting}', true))"
            );
        });

        /**
         * Isolation for a table that also holds platform-level rows.
         *
         * Used by audit_events, where tenant provisioning and break-glass
         * grants legitimately have no tenant.
         *
         * The rule is explicit rather than permissive:
         *   - tenant context set   -> see only that tenant's rows
         *   - tenant context unset -> see only rows with no tenant
         *
         * Note what this does NOT do: it never lets an unset context see
         * tenant rows. Platform and tenant data stay disjoint in both
         * directions, so this is not a hole in the isolation model.
         */
        Schema::macro('enableTenantIsolationWithPlatformRows', function (string $table): void {
            $setting = Tenancy::TENANT_SETTING;

            $predicate = <<<SQL
                CASE
                    WHEN coalesce(current_setting('{$setting}', true), '') = ''
                        THEN tenant_id IS NULL
                    ELSE tenant_id = current_setting('{$setting}', true)
                END
            SQL;

            DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
            DB::statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");
            DB::statement(
                "CREATE POLICY tenant_isolation ON {$table} ".
                "USING ({$predicate}) WITH CHECK ({$predicate})"
            );
        });

        /**
         * Isolation for a table that holds PLATFORM rows and no tenant's rows.
         *
         * The mirror image of enableTenantIsolation(), and it exists for
         * subscription billing: Carevelo invoicing a clinic for the software is
         * OUR revenue, collected into OUR merchant account, and it must not
         * become reachable from inside a clinic's session the way a clinic's own
         * payment records are.
         *
         *   - tenant context unset -> every row is visible
         *   - tenant context set   -> NO row is visible, and none may be written
         *
         * The second half is the one worth stating aloud. A table declared
         * platform-scoped and left without a policy is readable from anywhere,
         * which is fine for break_glass_grants -- a control surface the affected
         * clinic is entitled to see -- and is not fine here: these rows name
         * every clinic, what it pays and whether it has paid, so one clinic's
         * session reading them would disclose its competitors' commercial terms.
         *
         * A tenant_id column may still be present. It says WHO IS BEING BILLED,
         * not whose row this is, and that distinction is why the policy does not
         * compare it against anything. Comparing it would be worse than useless:
         * it would make the row visible to the clinic under RLS and thereby put
         * platform revenue inside a tenant's blast radius, which is the exact
         * blending of clinic money and Carevelo money that ADR-0003 forbids.
         *
         * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
         */
        Schema::macro('enablePlatformOnlyIsolation', function (string $table): void {
            $setting = Tenancy::TENANT_SETTING;

            // Note the shape: the predicate does not mention any column. A row
            // is visible because of WHO IS ASKING and never because of what it
            // contains, so no future column can widen it by accident.
            //
            // current_setting(..., true) yields NULL when the setting was never
            // established in this session, and '' when Tenancy::forget() cleared
            // it. coalesce collapses both to the same platform case; anything
            // else is a bound tenant and sees nothing.
            $predicate = "coalesce(current_setting('{$setting}', true), '') = ''";

            DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
            DB::statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");
            DB::statement(
                "CREATE POLICY platform_only ON {$table} ".
                "USING ({$predicate}) WITH CHECK ({$predicate})"
            );
        });

        /**
         * Marks a table as deliberately not tenant-scoped.
         *
         * Declarative only — it writes a comment the schema-conformance test
         * reads. A new table is presumed tenant-scoped; making one
         * platform-scoped should be a visible, reviewable act.
         */
        Schema::macro('markPlatformScoped', function (string $table, string $reason): void {
            DB::statement(sprintf(
                'COMMENT ON TABLE %s IS %s',
                $table,
                DB::getPdo()->quote('platform-scoped: '.$reason)
            ));
        });

        /**
         * Makes a table append-only for the application role.
         *
         * Used for audit_events. The application holds INSERT and SELECT and is
         * denied UPDATE and DELETE, so an attacker with application-level code
         * execution — the realistic compromise scenario — cannot cover their
         * tracks. Enforced by grants because a convention does not survive an
         * adversary.
         *
         * @see docs/70-decisions/0006-audit-log-immutability.md
         */
        Schema::macro('makeAppendOnly', function (string $table): void {
            $role = config('database.connections.pgsql.username');

            DB::statement("REVOKE UPDATE, DELETE ON {$table} FROM {$role}");
            DB::statement("GRANT INSERT, SELECT ON {$table} TO {$role}");
        });
    }
}
