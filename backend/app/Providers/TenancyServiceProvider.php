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
