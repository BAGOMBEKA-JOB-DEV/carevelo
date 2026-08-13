<?php

use App\Exceptions\Tenancy\TenantContextMissing;
use App\Models\Tenant;
use App\Support\ReferenceGenerator;
use App\Tenancy\Tenancy;
use Illuminate\Support\Facades\Date;

it('generates short references a person can read aloud', function () {
    Date::setTestNow('2026-08-13');

    $tenant = Tenant::factory()->create();

    $reference = app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(ReferenceGenerator::class)->next('APT')
    );

    expect($reference)->toBe('APT-2608-0001');
});

it('increments within a tenant', function () {
    Date::setTestNow('2026-08-13');

    $tenant = Tenant::factory()->create();

    $references = app(Tenancy::class)->run($tenant->id, function () {
        $generator = app(ReferenceGenerator::class);

        return [$generator->next('APT'), $generator->next('APT'), $generator->next('APT')];
    });

    expect($references)->toBe(['APT-2608-0001', 'APT-2608-0002', 'APT-2608-0003']);
});

it('numbers each tenant independently', function () {
    // Two clinics may both hold APT-2608-0001 and never see each other's. A
    // tenant-local sequence is what keeps the number short enough to say aloud.
    Date::setTestNow('2026-08-13');

    $tenancy = app(Tenancy::class);
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $first = $tenancy->run($tenantA->id, fn () => app(ReferenceGenerator::class)->next('APT'));
    $second = $tenancy->run($tenantB->id, fn () => app(ReferenceGenerator::class)->next('APT'));

    expect($first)->toBe('APT-2608-0001')
        ->and($second)->toBe('APT-2608-0001');
});

it('keeps separate sequences per prefix', function () {
    Date::setTestNow('2026-08-13');

    $tenant = Tenant::factory()->create();

    $references = app(Tenancy::class)->run($tenant->id, function () {
        $generator = app(ReferenceGenerator::class);

        return [$generator->next('APT'), $generator->next('RX'), $generator->next('PAY')];
    });

    expect($references)->toBe(['APT-2608-0001', 'RX-2608-0001', 'PAY-2608-0001']);
});

it('resets the sequence each month, keeping references short for years', function () {
    $tenant = Tenant::factory()->create();
    $tenancy = app(Tenancy::class);

    Date::setTestNow('2026-08-13');
    $august = $tenancy->run($tenant->id, fn () => app(ReferenceGenerator::class)->next('APT'));

    Date::setTestNow('2026-09-01');
    $september = $tenancy->run($tenant->id, fn () => app(ReferenceGenerator::class)->next('APT'));

    expect($august)->toBe('APT-2608-0001')
        ->and($september)->toBe('APT-2609-0001');
});

it('refuses to generate a reference with no tenant context', function () {
    app(ReferenceGenerator::class)->next('APT');
})->throws(TenantContextMissing::class);
