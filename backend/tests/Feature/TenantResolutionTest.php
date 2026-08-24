<?php

use App\Models\AuditEvent;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Tenancy\Tenancy;

/*
|--------------------------------------------------------------------------
| Tenant resolution over HTTP
|--------------------------------------------------------------------------
|
| Tenant identity comes from the request HOST or the authenticated session, and
| from nowhere else. A client-supplied tenant id would be a client-controlled
| authorisation decision.
|
| See docs/30-architecture/multi-tenancy.md
|
*/

function tenantUrl(Tenant $tenant, string $path): string
{
    $appHost = parse_url((string) config('app.url'), PHP_URL_HOST);

    return sprintf('http://%s.%s%s', $tenant->subdomain, $appHost, $path);
}

it('resolves the tenant from the subdomain', function () {
    $tenant = Tenant::factory()->create(['trading_name' => 'Ntinda Family Clinic']);

    $this->getJson(tenantUrl($tenant, '/api/v1/tenant'))
        ->assertOk()
        ->assertJsonPath('data.trading_name', 'Ntinda Family Clinic');
});

it('returns a neutral 404 for an unknown host', function () {
    // Never confirm or deny that a clinic uses Carevelo. Enumerating the
    // customer list should not be a loop over subdomains, and the fact that
    // someone is a patient of a specific clinic is health-adjacent.
    $this->getJson('http://not-a-clinic.carevelo.test/api/v1/tenant')
        ->assertNotFound();
});

it('never exposes the unverified compliance references', function () {
    // These are the clinic's own attestation. Exposing them on a
    // patient-facing endpoint would imply Carevelo had checked them.
    $tenant = Tenant::factory()->create([
        'umdpc_facility_reference' => 'UMDPC-12345',
        'nda_licence_reference' => 'NDA-67890',
    ]);

    $response = $this->getJson(tenantUrl($tenant, '/api/v1/tenant'))->assertOk();

    expect($response->json())->not->toContain('UMDPC-12345')
        ->and(json_encode($response->json()))->not->toContain('NDA-67890');
});

it('rejects a session belonging to another tenant, and audits it', function () {
    // Either a bug or an attack. Both deserve a record.
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $userOfA = User::factory()->create(['tenant_id' => $tenantA->id]);

    // `abort(403)` in middleware, not a policy denial -- a separate route to a 403
    // that was answering off-contract for the same reason, and is asserted here so
    // it cannot drift back.
    $this->actingAs($userOfA)
        ->getJson(tenantUrl($tenantB, '/api/v1/tenant'))
        ->assertForbidden()
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'forbidden');

    $audited = app(Tenancy::class)->run(
        $tenantB->id,
        fn () => AuditEvent::query()->where('action', 'tenant.host_mismatch')->count()
    );

    expect($audited)->toBe(1);
});

it('allows a session on its own tenant host', function () {
    $tenant = Tenant::factory()->create();
    $user = User::factory()->create(['tenant_id' => $tenant->id]);

    $this->actingAs($user)
        ->getJson(tenantUrl($tenant, '/api/v1/tenant'))
        ->assertOk();
});

it('hides a closed tenant entirely', function () {
    $tenant = Tenant::factory()->create(['status' => TenantStatus::Closed]);

    $this->getJson(tenantUrl($tenant, '/api/v1/tenant'))->assertNotFound();
});

it('still serves a suspended tenant, because suspension is commercial not clinical', function () {
    // Suspension blocks staff sign-in. It must never stop a patient reading
    // their own records or a delivery already in flight.
    $tenant = Tenant::factory()->suspended()->create();

    $this->getJson(tenantUrl($tenant, '/api/v1/tenant'))->assertOk();
});
