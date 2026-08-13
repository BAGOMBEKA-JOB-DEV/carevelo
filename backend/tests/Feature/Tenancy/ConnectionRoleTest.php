<?php

use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Mandatory test 3 -- connection role
|--------------------------------------------------------------------------
|
| The highest-consequence test in the suite, because the failure it detects is
| SILENT and TOTAL.
|
| PostgreSQL exempts a table's owner from row-level security. If the application
| connects as the owner, every RLS policy becomes inert: the system works
| perfectly and protects nothing, and no behavioural test would notice. There is
| no error, no warning, and no failing assertion anywhere else.
|
| See docs/80-quality/test-strategy.md and docs/50-security-compliance/threat-model.md
|
*/

it('connects as a role that cannot bypass row level security', function () {
    $role = DB::selectOne(
        'select current_user as name,
                (select rolbypassrls from pg_roles where rolname = current_user) as can_bypass,
                (select rolsuper     from pg_roles where rolname = current_user) as is_super'
    );

    expect($role->name)->toBe('carevelo_app')
        ->and($role->can_bypass)->toBeFalse('carevelo_app must hold NOBYPASSRLS')
        ->and($role->is_super)->toBeFalse('a superuser bypasses RLS unconditionally');
});

it('does not own any table it queries', function () {
    $appRole = DB::selectOne('select current_user as name')->name;

    $ownedByApp = DB::select(
        'select tablename from pg_tables where schemaname = ? and tableowner = ?',
        ['public', $appRole]
    );

    expect($ownedByApp)->toBeEmpty(
        'The application role must never own a table: PostgreSQL exempts owners '
        .'from RLS, so ownership silently disables every isolation policy.'
    );
});

it('runs migrations as a separate owner role', function () {
    $migrator = DB::connection('pgsql_migrator')->selectOne('select current_user as name')->name;
    $app = DB::selectOne('select current_user as name')->name;

    expect($migrator)->toBe('carevelo_migrator')
        ->and($migrator)->not->toBe($app);
});

it('runs the test suite against postgres, never sqlite', function () {
    // SQLite has no row-level security. If the suite ever silently fell back to
    // it, every isolation test below would pass while proving nothing.
    expect(DB::connection()->getDriverName())->toBe('pgsql')
        ->and(DB::connection()->getDatabaseName())->toBe('carevelo_testing');
});
