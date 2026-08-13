<?php

use App\Exceptions\Tenancy\TenantContextMissing;
use App\Models\Tenant;
use App\Support\TenantCache;
use App\Tenancy\Tenancy;

/*
|--------------------------------------------------------------------------
| Tenant-namespaced cache
|--------------------------------------------------------------------------
|
| An unprefixed cache key is a cross-tenant leak with a time delay: it passes
| every functional test and surfaces only in production, under load. One of the
| three highest-consequence failures in this system.
|
| See docs/50-security-compliance/threat-model.md
|
*/

it('namespaces keys by tenant', function () {
    $tenancy = app(Tenancy::class);
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $keyA = $tenancy->run($tenantA->id, fn () => app(TenantCache::class)->qualify('services'));
    $keyB = $tenancy->run($tenantB->id, fn () => app(TenantCache::class)->qualify('services'));

    expect($keyA)->not->toBe($keyB)
        ->and($keyA)->toContain($tenantA->id);
});

it('does not serve one tenant a value cached by another', function () {
    $tenancy = app(Tenancy::class);
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $tenancy->run($tenantA->id, fn () => app(TenantCache::class)->put('price', 15_000, 60));

    $seen = $tenancy->run($tenantB->id, fn () => app(TenantCache::class)->get('price'));

    expect($seen)->toBeNull();
});

it('refuses to build a key with no tenant context', function () {
    // Falling back to a global key is precisely the bug this class prevents,
    // so the absence of a tenant is fatal rather than silently permitted.
    app(TenantCache::class)->qualify('anything');
})->throws(TenantContextMissing::class);
