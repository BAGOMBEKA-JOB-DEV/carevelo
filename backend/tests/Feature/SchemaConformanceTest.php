<?php

use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Mandatory test 2 -- schema conformance
|--------------------------------------------------------------------------
|
| Every table either carries tenant_id with RLS enabled AND forced, or appears
| on the platform-scoped allow-list below.
|
| This catches the commonest real mistake: a new table shipped without RLS. A
| new table is PRESUMED tenant-scoped; making one platform-scoped must be a
| visible, reviewable act rather than an omission.
|
| See docs/80-quality/test-strategy.md
|
*/

/**
 * Tables that deliberately hold no tenant_id.
 *
 * Adding to this list is a decision, not a convenience.
 *
 * @return list<string>
 */
function platformScopedTables(): array
{
    return [
        'tenants',                  // the tenant register itself
        'users',                    // auth must find a user before a tenant resolves
        'migrations',               // schema versioning
        'jobs', 'job_batches', 'failed_jobs',   // queue infrastructure
        'cache', 'cache_locks',     // cache store
        'sessions', 'password_reset_tokens',
        'personal_access_tokens',
        'permissions', 'roles', 'model_has_permissions',
        'model_has_roles', 'role_has_permissions',
        'audit_events',             // holds platform rows too; own policy
    ];
}

it('has row level security enabled and forced on every tenant-scoped table', function () {
    $tables = DB::select("
        select c.relname as table_name,
               c.relrowsecurity as rls_enabled,
               c.relforcerowsecurity as rls_forced,
               exists (
                   select 1 from information_schema.columns col
                   where col.table_name = c.relname
                     and col.column_name = 'tenant_id'
               ) as has_tenant_id
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname
    ");

    $failures = [];

    foreach ($tables as $table) {
        if (in_array($table->table_name, platformScopedTables(), true)) {
            continue;
        }

        if (! $table->has_tenant_id) {
            $failures[] = "{$table->table_name}: no tenant_id and not on the platform-scoped list";

            continue;
        }

        if (! $table->rls_enabled) {
            $failures[] = "{$table->table_name}: RLS not enabled";
        }

        // FORCE matters: without it the table OWNER is exempt, so the migrator
        // -- and anything else owning the table -- reads every tenant's rows.
        if (! $table->rls_forced) {
            $failures[] = "{$table->table_name}: RLS not FORCED (owner would be exempt)";
        }
    }

    expect($failures)->toBeEmpty(implode("\n", $failures));
});

it('has an isolation policy on every tenant-scoped table', function () {
    $withRls = DB::select("
        select c.relname as table_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    ");

    $missing = [];

    foreach ($withRls as $table) {
        $policies = DB::select(
            'select policyname from pg_policies where schemaname = ? and tablename = ?',
            ['public', $table->table_name]
        );

        if ($policies === []) {
            $missing[] = $table->table_name;
        }
    }

    expect($missing)->toBeEmpty(
        'RLS enabled but no policy -- the table is locked, not isolated: '.implode(', ', $missing)
    );
});

it('keeps the audit log append-only for the application role', function () {
    $grants = DB::select("
        select privilege_type
        from information_schema.role_table_grants
        where table_name = 'audit_events' and grantee = current_user
    ");

    $held = array_map(fn ($g) => $g->privilege_type, $grants);

    expect($held)->toContain('INSERT')
        ->and($held)->toContain('SELECT')
        ->and($held)->not->toContain('UPDATE')
        ->and($held)->not->toContain('DELETE');
});
