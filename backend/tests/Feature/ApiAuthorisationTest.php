<?php

use App\Models\ClinicalRole;
use App\Models\Delivery;
use App\Models\PaymentIntent;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| Mandatory test 8 -- data minimisation, plus API denial coverage
|--------------------------------------------------------------------------
|
| Denial tests are the ones that catch privilege escalation, and the ones
| usually skipped. Every endpoint is tested for what it REFUSES as well as what
| it permits.
|
| See docs/80-quality/test-strategy.md and docs/50-security-compliance/rbac-matrix.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function apiUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/** @return array{Tenant, User, Delivery} */
function riderFixture(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $rider = User::factory()->create(['tenant_id' => $tenant->id]);
        $rider->assignRole(ClinicalRole::Rider->value);

        $delivery = Delivery::factory()->create(['rider_id' => $rider->id]);
        $delivery->assignTo($rider->id);

        return [$tenant, $rider, $delivery];
    });
}

it('gives a rider no clinical field whatsoever', function () {
    // THE data-minimisation test. The rider is the least-trusted human actor
    // and needs the least data: recipient, phone, address, reference. Nothing
    // clinical, ever.
    [$tenant, $rider, $delivery] = riderFixture();

    $response = $this->actingAs($rider)
        ->getJson(apiUrl($tenant, "/api/v1/rider/deliveries/{$delivery->id}"))
        ->assertOk();

    $body = strtolower(json_encode($response->json()) ?: '');

    $forbidden = [
        'diagnosis', 'medicine', 'prescription', 'clinical', 'note',
        'dosage', 'directions', 'condition',
    ];

    foreach ($forbidden as $term) {
        expect($body)->not->toContain($term, "Rider payload leaked '{$term}'");
    }

    // And it does carry exactly what a rider needs.
    $response->assertJsonStructure([
        'data' => ['id', 'reference', 'recipient_name', 'recipient_phone', 'address_text', 'status'],
    ]);
});

it('refuses a rider access to another rider\'s delivery', function () {
    [$tenant, , $delivery] = riderFixture();

    $otherRider = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $u = User::factory()->create(['tenant_id' => $tenant->id]);
        $u->assignRole(ClinicalRole::Rider->value);

        return $u;
    });

    $this->actingAs($otherRider)
        ->getJson(apiUrl($tenant, "/api/v1/rider/deliveries/{$delivery->id}"))
        ->assertForbidden();
});

it('returns 404 not 403 for a resource in another tenant', function () {
    // A 403 would CONFIRM the resource exists, leaking that a given reference
    // belongs to some other clinic. With RLS the row simply is not there.
    $tenancy = app(Tenancy::class);
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $intentOfA = $tenancy->run($tenantA->id, fn () => PaymentIntent::factory()->create());

    $userOfB = $tenancy->run($tenantB->id, function () use ($tenantB) {
        $u = User::factory()->create(['tenant_id' => $tenantB->id]);
        $u->assignRole(ClinicalRole::ClinicAdmin->value);

        return $u;
    });

    $this->actingAs($userOfB)
        ->getJson(apiUrl($tenantB, "/api/v1/payment-intents/{$intentOfA->id}"))
        ->assertNotFound();
});

it('requires an idempotency key to create a payment intent', function () {
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $u = User::factory()->create(['tenant_id' => $tenant->id]);
        $u->assignRole(ClinicalRole::ClinicAdmin->value);

        return $u;
    });

    $this->actingAs($admin)
        ->postJson(apiUrl($tenant, '/api/v1/payment-intents'), [
            'payable_type' => 'appointment',
            'payable_id' => '01JABCDEF',
            'amount_minor' => 3_000_000,
            'method' => 'mtn_momo',
        ])
        ->assertStatus(400)
        ->assertJsonPath('code', 'idempotency_key_required');
});

it('returns the stored response when an idempotency key is replayed', function () {
    // No second charge. This is the mechanism that stops a patient paying
    // twice for one consultation.
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $u = User::factory()->create(['tenant_id' => $tenant->id]);
        $u->assignRole(ClinicalRole::ClinicAdmin->value);

        return $u;
    });

    $body = [
        'payable_type' => 'appointment',
        'payable_id' => '01JABCDEF',
        'amount_minor' => 3_000_000,
        'method' => 'mtn_momo',
    ];

    $first = $this->actingAs($admin)
        ->withHeader('Idempotency-Key', 'key-123')
        ->postJson(apiUrl($tenant, '/api/v1/payment-intents'), $body)
        ->assertCreated();

    $second = $this->actingAs($admin)
        ->withHeader('Idempotency-Key', 'key-123')
        ->postJson(apiUrl($tenant, '/api/v1/payment-intents'), $body)
        ->assertOk();

    expect($second->json('data.id'))->toBe($first->json('data.id'));

    expect(app(Tenancy::class)->run($tenant->id, fn () => PaymentIntent::query()->count()))->toBe(1);
});

it('rejects a replayed idempotency key with a different body', function () {
    // A client bug. Silently processing it is how money goes missing.
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $u = User::factory()->create(['tenant_id' => $tenant->id]);
        $u->assignRole(ClinicalRole::ClinicAdmin->value);

        return $u;
    });

    $this->actingAs($admin)
        ->withHeader('Idempotency-Key', 'key-abc')
        ->postJson(apiUrl($tenant, '/api/v1/payment-intents'), [
            'payable_type' => 'appointment', 'payable_id' => '01JA',
            'amount_minor' => 3_000_000, 'method' => 'mtn_momo',
        ])->assertCreated();

    $this->actingAs($admin)
        ->withHeader('Idempotency-Key', 'key-abc')
        ->postJson(apiUrl($tenant, '/api/v1/payment-intents'), [
            'payable_type' => 'appointment', 'payable_id' => '01JA',
            'amount_minor' => 99_999_999, 'method' => 'mtn_momo',
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'idempotency_key_reused');
});

it('refuses an unauthenticated request to a protected endpoint', function () {
    $tenant = Tenant::factory()->create();

    $this->getJson(apiUrl($tenant, '/api/v1/rider/deliveries'))->assertUnauthorized();
});

it('returns RFC 9457 problem details on validation failure', function () {
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $u = User::factory()->create(['tenant_id' => $tenant->id]);
        $u->assignRole(ClinicalRole::ClinicAdmin->value);

        return $u;
    });

    $this->actingAs($admin)
        ->withHeader('Idempotency-Key', 'key-xyz')
        ->postJson(apiUrl($tenant, '/api/v1/payment-intents'), ['method' => 'mtn_momo'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonStructure(['type', 'title', 'status', 'code', 'errors']);
});
