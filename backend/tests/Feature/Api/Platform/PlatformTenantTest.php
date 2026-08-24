<?php

use App\Models\ClinicalRole;
use App\Models\Consultation;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Services\Platform\TenantExport;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| Platform administration
|--------------------------------------------------------------------------
|
| Three claims, each of which the platform would be unsafe without:
|
|   1. platform roles reach tenant ADMINISTRATION and no clinical data;
|   2. suspension is COMMERCIAL and never becomes clinical;
|   3. the offboarding export is an OBLIGATION, so a commercial dispute cannot
|      block it.
|
| These routes run without ResolveTenant, so they are addressed on the bare
| application host and no tenant is bound. Anything that needs a clinic's own
| rows -- fixtures included -- goes through Tenancy::run().
|
| See docs/50-security-compliance/rbac-matrix.md
| and docs/50-security-compliance/data-retention-and-deletion.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    /*
     * THE Referer IS LOAD-BEARING AND LOOKS LIKE NOISE. Sanctum starts a session
     * only for a request whose Origin or Referer host is in `config/sanctum.php`'s
     * stateful list -- a browser always sends one and Laravel's test client never
     * does. Without it `EnsureFrontendRequestsAreStateful` skips StartSession, so
     * `$request->hasSession()` is false, `RequireSecondFactor` can find no verified
     * stamp however it was placed, and every call here answers 403.
     *
     * These tests predate the second factor entirely, which is why the header was
     * never needed before. @see tests/Feature/Platform/TotpEnrolmentTest.php
     */
    $this->withHeader('Referer', sprintf(
        'http://%s/',
        parse_url((string) config('app.url'), PHP_URL_HOST),
    ));
});

/** Cross-tenant routes have no tenant host to be addressed on. */
function platformUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/** A Carevelo operator: no tenant_id, because we belong to no clinic. */
function platformUser(ClinicalRole $role): User
{
    $user = User::factory()->create(['tenant_id' => null]);
    $user->assignRole($role->value);

    return $user;
}

function tenantUser(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

it('serves the tenant register to a platform administrator', function () {
    $tenant = Tenant::factory()->create();

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->getJson(platformUrl('/api/v1/platform/tenants'))
        ->assertOk();

    expect(array_column((array) $response->json('data'), 'id'))->toContain($tenant->id);
});

it('serves the tenant register to platform support', function () {
    Tenant::factory()->create();

    $this->actingAsOperator(platformUser(ClinicalRole::PlatformSupport))
        ->getJson(platformUrl('/api/v1/platform/tenants'))
        ->assertOk();
});

it('refuses the tenant register to a clinic administrator', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAs(tenantUser($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(platformUrl('/api/v1/platform/tenants'))
        ->assertForbidden();
});

it('puts no clinical figure on the tenant register', function () {
    // Not even a count. An aggregate is still an observation about a clinic's
    // patients, and the register exists to answer commercial questions.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->count(3)->create());

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformSupport))
        ->getJson(platformUrl('/api/v1/platform/tenants'))
        ->assertOk();

    $body = strtolower((string) json_encode($response->json()));

    foreach (['patient', 'consultation', 'prescription', 'diagnosis', 'medicine'] as $term) {
        expect($body)->not->toContain($term, "The tenant register leaked '{$term}'");
    }
});

it('gives a platform role no route to a clinic\'s patients', function () {
    // THE test behind acceptance criterion 8. A platform operator signed in and
    // addressing a clinic's own host still reaches nothing clinical, because
    // every clinical policy denies a user with no tenant_id.
    $tenant = Tenant::factory()->create();
    $operator = platformUser(ClinicalRole::PlatformAdmin);

    $host = sprintf('http://%s.%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST));

    $this->actingAs($operator)
        ->getJson($host.'/api/v1/patients')
        ->assertForbidden();

    $this->actingAs($operator)
        ->getJson($host.'/api/v1/prescriptions')
        ->assertForbidden();
});

it('gives platform support no route to a consultation', function () {
    $tenant = Tenant::factory()->create();

    $consultation = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Consultation::factory()->create(),
    );

    $host = sprintf('http://%s.%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST));

    $this->actingAsOperator(platformUser(ClinicalRole::PlatformSupport))
        ->getJson($host."/api/v1/consultations/{$consultation->id}")
        ->assertForbidden();
});

it('provisions a clinic in provisioning, never active', function () {
    $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl('/api/v1/platform/tenants'), [
            'legal_name' => 'Kira Health Services Limited',
            'trading_name' => 'Kira Clinic',
            'subdomain' => 'kira-clinic',
            'contact_phone' => '0772123456',
        ])
        ->assertCreated()
        ->assertJsonPath('data.status', TenantStatus::Provisioning->value)
        ->assertJsonPath('data.subdomain', 'kira-clinic')
        ->assertJsonPath('data.attestations.verified_by_carevelo', false);
});

it('rejects a subdomain reserved for the platform', function () {
    // A clinic on `api` or `admin` does not merely have an awkward name -- it
    // shadows a platform host, and the subdomain is immutable afterwards.
    foreach (['api', 'admin', 'www', 'reverb'] as $reserved) {
        $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
            ->postJson(platformUrl('/api/v1/platform/tenants'), [
                'legal_name' => 'Reserved Word Medical Centre',
                'subdomain' => $reserved,
            ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors('subdomain');
    }
});

it('rejects a reserved subdomain submitted in mixed case', function () {
    $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl('/api/v1/platform/tenants'), [
            'legal_name' => 'Upper Case Medical Centre',
            'subdomain' => 'API',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('subdomain');
});

it('refuses provisioning to platform support', function () {
    $this->actingAsOperator(platformUser(ClinicalRole::PlatformSupport))
        ->postJson(platformUrl('/api/v1/platform/tenants'), [
            'legal_name' => 'Support Should Not Provision Clinic',
            'subdomain' => 'support-should-not',
        ])
        ->assertForbidden();
});

it('suspends a clinic and refuses an illegal lifecycle move', function () {
    $tenant = Tenant::factory()->create();
    $admin = platformUser(ClinicalRole::PlatformAdmin);

    $this->actingAsOperator($admin)
        ->patchJson(platformUrl("/api/v1/platform/tenants/{$tenant->id}"), [
            'status' => TenantStatus::Suspended->value,
        ])
        ->assertOk()
        ->assertJsonPath('data.is_suspended', true);

    // suspended -> provisioning is not a move TenantStatus allows.
    $this->actingAsOperator($admin)
        ->patchJson(platformUrl("/api/v1/platform/tenants/{$tenant->id}"), [
            'status' => TenantStatus::Provisioning->value,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('still serves a suspended clinic to its own patients', function () {
    // Suspension is COMMERCIAL. It blocks staff sign-in; it must never stop a
    // patient reading their own records or a delivery already in flight, so the
    // tenant read endpoint keeps answering for a suspended clinic.
    $tenant = Tenant::factory()->suspended()->create();

    $this->getJson(sprintf(
        'http://%s.%s/api/v1/tenant',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
    ))
        ->assertOk()
        ->assertJsonPath('data.id', $tenant->id);
});

it('exports a suspended clinic\'s data anyway', function () {
    // The clinic leaves with its data REGARDLESS of any commercial dispute.
    // Withholding it to secure payment would be unlawful and would harm
    // patients, so there is no status check on the export and never will be.
    $tenant = Tenant::factory()->suspended()->create();

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->count(2)->create());

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl("/api/v1/platform/tenants/{$tenant->id}/export"))
        ->assertOk();

    expect($response->json('data.counts.patients'))->toBe(2)
        ->and($response->json('data.tenant.id'))->toBe($tenant->id);
});

it('covers every class of record the clinic is the controller of', function () {
    $tenant = Tenant::factory()->create();

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl("/api/v1/platform/tenants/{$tenant->id}/export"))
        ->assertOk();

    $records = $response->json('data.records');

    foreach (array_keys(TenantExport::CONTENTS) as $section) {
        expect($records)->toHaveKey($section);
    }

    // The named set from the retention document, spelled out so a later change
    // that quietly drops one fails here.
    foreach ([
        'patients', 'consent_records', 'consultations', 'clinical_notes',
        'prescriptions', 'dispense_orders', 'deliveries', 'payment_intents',
        'audit_events',
    ] as $section) {
        expect($records)->toHaveKey($section);
    }
});

it('never exports aggregator credentials', function () {
    // Unreadable by every role including this one. The clinic already holds
    // them: they are its own credentials at its own aggregator.
    $tenant = Tenant::factory()->create();

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl("/api/v1/platform/tenants/{$tenant->id}/export"))
        ->assertOk();

    $body = strtolower((string) json_encode($response->json('data.records')));

    foreach (['api_key', 'secret_key', 'webhook_secret', 'aggregator_account'] as $term) {
        expect($body)->not->toContain($term, "The export leaked '{$term}'");
    }
});

it('exports only the named clinic\'s records', function () {
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $tenancy = app(Tenancy::class);
    $tenancy->run($tenantA->id, fn () => Patient::factory()->count(2)->create());
    $tenancy->run($tenantB->id, fn () => Patient::factory()->count(5)->create());

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl("/api/v1/platform/tenants/{$tenantA->id}/export"))
        ->assertOk();

    expect($response->json('data.counts.patients'))->toBe(2);

    foreach ($response->json('data.records.patients') as $patient) {
        expect($patient['tenant_id'])->toBe($tenantA->id);
    }
});

it('lets a clinic administrator export their own clinic and nobody else\'s', function () {
    $tenant = Tenant::factory()->create();
    $other = Tenant::factory()->create();
    $admin = tenantUser($tenant, ClinicalRole::ClinicAdmin);

    $this->actingAs($admin)
        ->postJson(platformUrl("/api/v1/platform/tenants/{$tenant->id}/export"))
        ->assertOk();

    $this->actingAs($admin)
        ->postJson(platformUrl("/api/v1/platform/tenants/{$other->id}/export"))
        ->assertForbidden();
});

it('reports system health without naming a clinic', function () {
    Tenant::factory()->create();
    Tenant::factory()->suspended()->create();

    $response = $this->actingAsOperator(platformUser(ClinicalRole::PlatformSupport))
        ->getJson(platformUrl('/api/v1/platform/health'))
        ->assertOk()
        ->assertJsonStructure([
            'data' => [
                'checked_at',
                'database' => ['role', 'isolation_enforced'],
                'tenants',
                'break_glass' => ['active_grants'],
            ],
        ]);

    // The failure that is otherwise silent and total: an application role
    // exempt from RLS leaves every isolation policy inert.
    expect($response->json('data.database.isolation_enforced'))->toBeTrue()
        ->and($response->json('data.tenants.suspended'))->toBeGreaterThanOrEqual(1)
        ->and($response->json('data.tenants.offboarding'))->toBe(0);
});

it('refuses platform health to a clinic administrator', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAs(tenantUser($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(platformUrl('/api/v1/platform/health'))
        ->assertForbidden();
});

it('refuses every platform route to an unauthenticated caller', function () {
    $this->getJson(platformUrl('/api/v1/platform/tenants'))->assertUnauthorized();
    $this->getJson(platformUrl('/api/v1/platform/health'))->assertUnauthorized();
});

it('rejects an unknown field on provisioning', function () {
    $this->actingAsOperator(platformUser(ClinicalRole::PlatformAdmin))
        ->postJson(platformUrl('/api/v1/platform/tenants'), [
            'legal_name' => 'Unknown Field Medical Centre',
            'subdomain' => 'unknown-field',
            'status' => TenantStatus::Active->value,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');
});
