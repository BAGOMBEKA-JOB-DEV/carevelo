<?php

use Illuminate\Database\Eloquent\Model;
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

/**
 * Every concrete Eloquent model in the application.
 *
 * Discovered from the filesystem rather than listed, so a model added without a
 * thought for its timestamps is still checked.
 *
 * @return list<class-string<Model>>
 */
function modelClasses(): array
{
    $classes = [];

    foreach (glob(app_path('Models/*.php')) ?: [] as $path) {
        $class = 'App\\Models\\'.basename($path, '.php');

        if (! class_exists($class)) {
            continue;
        }

        // is_subclass_of before the reflection check: it narrows $class to
        // class-string<Model>, which is what this function promises to return.
        if (! is_subclass_of($class, Model::class)) {
            continue;
        }

        if ((new ReflectionClass($class))->isAbstract()) {
            continue;
        }

        $classes[] = $class;
    }

    return $classes;
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

it('writes an offset with every timestamptz, so no instant depends on the server timezone', function () {
    // Laravel's default date format is 'Y-m-d H:i:s' -- no offset. Writing that
    // into a timestamptz column makes PostgreSQL resolve the wall time in the
    // SESSION's timezone, so the instant actually stored depends on how the
    // database server happens to be configured.
    //
    // This shipped broken and no test caught it, because the developer machine's
    // session timezone was Africa/Asmara (+03:00) -- the same offset as the
    // clinics'. Every appointment was stored correctly by coincidence. On a UTC
    // server the same code stored 09:00 EAT as 09:00 UTC: an appointment three
    // hours from the one the patient booked.
    //
    // Models fix it by declaring $dateFormat = 'Y-m-d H:i:sP'. Three did. The
    // rest did not, which is why this is a test and not a code review comment.
    $offsetPreserving = 'Y-m-d H:i:sP';

    $tablesWithTimestamptz = array_column(DB::select("
        select distinct table_name
        from information_schema.columns
        where table_schema = 'public' and data_type = 'timestamp with time zone'
    "), 'table_name');

    $failures = [];

    foreach (modelClasses() as $class) {
        $model = new $class;

        if (! in_array($model->getTable(), $tablesWithTimestamptz, true)) {
            continue;
        }

        if ($model->getDateFormat() !== $offsetPreserving) {
            $failures[] = sprintf(
                '%s (%s): date format is %s -- must be %s or the stored instant '
                .'depends on the database server timezone',
                class_basename($class),
                $model->getTable(),
                var_export($model->getDateFormat(), true),
                $offsetPreserving,
            );
        }
    }

    expect($failures)->toBeEmpty("\n".implode("\n", $failures));
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
