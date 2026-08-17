<?php

use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Mandatory test 2 -- schema conformance
|--------------------------------------------------------------------------
|
| Every table either carries tenant_id with RLS enabled AND forced, or is
| declared platform-scoped.
|
| This catches the commonest real mistake: a new table shipped without RLS. A
| new table is PRESUMED tenant-scoped; making one platform-scoped must be a
| visible, reviewable act rather than an omission.
|
| A table declares itself platform-scoped by calling Schema::markPlatformScoped()
| in its own migration, which stamps a reason onto the table comment. That is the
| declaration this file reads. It deliberately lives in the migration rather than
| in a list here: the exemption is then visible in the same diff that creates the
| table, and `\d+` in psql shows it to anyone auditing the live database.
|
| The list below is only for tables whose migrations we do not own -- framework
| and package infrastructure that will never call our macro.
|
| See docs/80-quality/test-strategy.md
|
*/

/**
 * Infrastructure tables from framework and package migrations.
 *
 * These hold no tenant data and cannot declare themselves, because we do not
 * write their migrations. Everything WE create declares itself instead.
 *
 * @return list<string>
 */
function foreignInfrastructureTables(): array
{
    return [
        'migrations',               // schema versioning
        'jobs', 'job_batches', 'failed_jobs',   // queue infrastructure
        'cache', 'cache_locks',     // cache store
        'sessions', 'password_reset_tokens',
        'personal_access_tokens',
        'permissions', 'roles', 'model_has_permissions',
        'model_has_roles', 'role_has_permissions',
    ];
}

/**
 * Tables the schema itself declares platform-scoped, mapped to the reason given.
 *
 * @return array<string, string>
 */
function declaredPlatformScopedTables(): array
{
    $declared = DB::select("
        select c.relname as table_name,
               obj_description(c.oid, 'pg_class') as comment
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and obj_description(c.oid, 'pg_class') like 'platform-scoped:%'
    ");

    $reasons = [];

    foreach ($declared as $table) {
        $reasons[(string) $table->table_name] = (string) $table->comment;
    }

    return $reasons;
}

/**
 * Whether this table is exempt from the tenant-scoping presumption.
 */
function isPlatformScoped(string $table): bool
{
    return in_array($table, foreignInfrastructureTables(), true)
        || array_key_exists($table, declaredPlatformScopedTables());
}

it('states a reason for every table it exempts from tenant scoping', function () {
    // markPlatformScoped() requires a reason, so an empty one means the comment
    // was written by something else and the exemption is not actually declared.
    foreach (declaredPlatformScopedTables() as $table => $reason) {
        expect(trim(str_replace('platform-scoped:', '', $reason)))
            ->not->toBe('', "{$table}: declared platform-scoped with no reason");
    }
});

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
        if (isPlatformScoped((string) $table->table_name)) {
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
