<?php

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

/*
|--------------------------------------------------------------------------
| Health endpoints
|--------------------------------------------------------------------------
|
| /health/live and /health/ready are ordinary probes. /health/isolation is not:
| it is the standing assertion that row-level security is still doing anything
| at all.
|
| PostgreSQL exempts a table's owner from RLS. If the application role owns a
| table, every policy becomes inert and the system works perfectly while
| protecting nothing -- no error, no warning, and no other test in this suite
| fails. The failure path below reproduces exactly that by pointing the runtime
| connection at the migrator role, which owns all forty tables.
|
| See docs/30-architecture/observability.md
|
*/

/** Health routes resolve no tenant, so any host on the application domain works. */
function healthUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

// --- Liveness --------------------------------------------------------------

it('answers liveness without touching a dependency', function () {
    // No query, deliberately: a liveness probe that failed on a database
    // incident would restart every healthy container mid-outage.
    $queries = 0;
    DB::listen(function () use (&$queries) {
        $queries++;
    });

    $this->getJson(healthUrl('/api/health/live'))
        ->assertOk()
        ->assertJsonPath('status', 'alive');

    expect($queries)->toBe(0);
});

// --- Readiness -------------------------------------------------------------

it('reports the dependencies a request needs', function () {
    // Redis is faked in both directions rather than assumed present, so the
    // check is proved rather than inherited from the developer's machine.
    Redis::shouldReceive('connection')->andReturnSelf();
    Redis::shouldReceive('command')->with('ping')->andReturn(true);

    $this->getJson(healthUrl('/api/health/ready'))
        ->assertOk()
        ->assertJsonPath('status', 'ready')
        ->assertJsonPath('checks.database', 'ok')
        ->assertJsonPath('checks.redis', 'ok')
        ->assertJsonPath('checks.storage', 'ok');
});

it('reports not ready, with no detail, when a dependency is unreachable', function () {
    Redis::shouldReceive('connection')->andThrow(
        new RuntimeException('Connection refused at redis-primary.internal:6379')
    );

    $response = $this->getJson(healthUrl('/api/health/ready'))
        ->assertStatus(503)
        ->assertJsonPath('status', 'not_ready')
        ->assertJsonPath('checks.redis', 'unavailable')
        ->assertJsonPath('checks.database', 'ok');

    // The host, the port and the driver message stay inside the application: a
    // failing health endpoint must not become a reconnaissance endpoint.
    $body = (string) json_encode($response->json());

    foreach (['redis-primary.internal', '6379', 'Connection refused'] as $leak) {
        expect(str_contains($body, $leak))->toBeFalse("The readiness response leaked '{$leak}'");
    }
});

// --- Isolation -------------------------------------------------------------

it('confirms the application role cannot bypass row level security', function () {
    $this->getJson(healthUrl('/api/health/isolation'))
        ->assertOk()
        ->assertJsonPath('status', 'isolated')
        ->assertJsonPath('checks.role_cannot_bypass_rls', 'pass')
        ->assertJsonPath('checks.role_owns_no_table', 'pass')
        ->assertJsonPath('checks.role_cannot_create_tables', 'pass')
        ->assertJsonPath('owned_table_count', 0);
});

it('asks the database which tables the connected role owns', function () {
    // The check must be capable of catching ownership, not merely of returning
    // a green payload. Two things are asserted: that the endpoint really asks
    // pg_tables about the CURRENT role, and that the question it asks finds
    // tables when the role does own some.
    $statements = [];
    DB::listen(function ($query) use (&$statements) {
        $statements[] = $query->sql;
    });

    $this->getJson(healthUrl('/api/health/isolation'))->assertOk();

    $ownership = array_values(array_filter(
        $statements,
        fn (string $sql) => str_contains($sql, 'pg_tables') && str_contains($sql, 'tableowner'),
    ));

    expect($ownership)->not->toBeEmpty('The isolation check never asked about table ownership')
        ->and($ownership[0])->toContain('current_user');

    // The same question, asked of a role that DOES own the tables, must come
    // back non-empty -- otherwise the query is vacuous and the pass above means
    // nothing.
    $ownedByMigrator = DB::select(
        str_replace('current_user', '?', $ownership[0]),
        ['public', 'carevelo_migrator']
    );

    expect($ownedByMigrator)->not->toBeEmpty(
        'The ownership query cannot detect a role that owns tables, so it proves nothing'
    );
});

it('reports 503 when the connected role owns tables and may create more', function () {
    // Failure mode 1 from the threat model, reproduced exactly: the runtime
    // connection now uses the OWNER role. Every other test in this suite would
    // still pass, which is the entire point of having this endpoint.
    config(['database.connections.pgsql' => config('database.connections.pgsql_migrator')]);
    DB::purge('pgsql');

    $response = $this->getJson(healthUrl('/api/health/isolation'))
        ->assertStatus(503)
        ->assertJsonPath('status', 'compromised')
        ->assertJsonPath('checks.role_owns_no_table', 'fail')
        ->assertJsonPath('checks.role_cannot_create_tables', 'fail');

    expect($response->json('owned_table_count'))->toBeGreaterThan(0);
});

// --- Disclosure ------------------------------------------------------------

it('reveals nothing about tenants from any health endpoint', function () {
    $tenant = Tenant::factory()->create();

    Redis::shouldReceive('connection')->andReturnSelf();
    Redis::shouldReceive('command')->with('ping')->andReturn(true);

    $forbidden = [
        strtolower($tenant->id),
        strtolower($tenant->subdomain),
        strtolower($tenant->legal_name),
        // A table name is schema disclosure and a tenant count is a customer
        // count. Neither belongs on an unauthenticated endpoint, and our tenants
        // are frequently each other's local competitors.
        'tenants',
        'patients',
    ];

    foreach (['/api/health/live', '/api/health/ready', '/api/health/isolation'] as $path) {
        $body = strtolower((string) $this->getJson(healthUrl($path))->getContent());

        foreach ($forbidden as $leak) {
            expect(str_contains($body, $leak))->toBeFalse("{$path} disclosed '{$leak}'");
        }
    }
});
