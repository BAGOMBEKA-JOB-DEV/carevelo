<?php

use App\Exceptions\Tenancy\TenantContextMissing;
use App\Models\Patient;
use App\Models\Tenant;
use App\Tenancy\Tenancy;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| Mandatory tests 1 and 4 -- cross-tenant isolation
|--------------------------------------------------------------------------
|
| Each clinic is a separate data controller of special-category health data, and
| our tenants are frequently each other's local competitors. A cross-tenant leak
| is a notifiable breach affecting two controllers at once.
|
| The point of these tests is that they exercise the paths that BYPASS Eloquent's
| global scope. A test that only calls Patient::find() proves the convenience
| layer works and says nothing at all about the control.
|
| See docs/80-quality/test-strategy.md and docs/30-architecture/multi-tenancy.md
|
*/

/**
 * Two tenants, with one patient belonging to the first.
 *
 * @return array{Tenancy, Tenant, Tenant, Patient}
 */
function isolationFixture(): array
{
    $tenancy = app(Tenancy::class);

    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $patientA = $tenancy->run($tenantA->id, fn () => Patient::factory()->create([
        'given_name' => 'Aisha',
        'family_name' => 'Namuli',
    ]));

    return [$tenancy, $tenantA, $tenantB, $patientA];
}

it('does not leak through an Eloquent primary key lookup', function () {
    // The dangerous one: it looks completely normal, it appears in every
    // controller, and it is not scoped by a global scope.
    [$tenancy, , $tenantB, $patientA] = isolationFixture();

    expect($tenancy->run($tenantB->id, fn () => Patient::find($patientA->id)))->toBeNull();
});

it('does not leak when the global scope is removed', function () {
    [$tenancy, , $tenantB, $patientA] = isolationFixture();

    $found = $tenancy->run(
        $tenantB->id,
        fn () => Patient::withoutGlobalScopes()->find($patientA->id)
    );

    expect($found)->toBeNull();
});

it('does not leak through the query builder', function () {
    // DB::table() never consults an Eloquent scope. Only RLS stops this.
    [$tenancy, , $tenantB, $patientA] = isolationFixture();

    $found = $tenancy->run(
        $tenantB->id,
        fn () => DB::table('patients')->where('id', $patientA->id)->first()
    );

    expect($found)->toBeNull();
});

it('does not leak through raw sql', function () {
    [$tenancy, , $tenantB, $patientA] = isolationFixture();

    $rows = $tenancy->run(
        $tenantB->id,
        fn () => DB::select('select * from patients where id = ?', [$patientA->id])
    );

    expect($rows)->toBeEmpty();
});

it('returns nothing at all when no tenant context is set', function () {
    // Fail-closed by construction: current_setting(..., true) is NULL when
    // unset, the comparison yields NULL, no rows match. Unset context means
    // zero rows, never all rows.
    isolationFixture();

    expect(DB::table('patients')->count())->toBe(0)
        ->and(Patient::withoutGlobalScopes()->count())->toBe(0);
});

it('blocks a write into another tenant', function () {
    // WITH CHECK. Without it an attacker could insert into a tenant they
    // cannot read.
    [$tenancy, $tenantA, $tenantB] = isolationFixture();

    $tenancy->run($tenantB->id, function () use ($tenantA) {
        DB::table('patients')->insert([
            'id' => (string) Str::ulid(),
            'tenant_id' => $tenantA->id,
            'given_name' => 'Injected',
            'family_name' => 'Row',
            'phone' => '+256700000001',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });
})->throws(QueryException::class, 'row-level security');

it('sees its own rows when the context matches', function () {
    // The positive case: isolation that blocks everything is not isolation,
    // it is an outage.
    [$tenancy, $tenantA, , $patientA] = isolationFixture();

    $found = $tenancy->run($tenantA->id, fn () => Patient::findOrFail($patientA->id));

    expect($found->given_name)->toBe('Aisha');
});

it('refuses to move a record between tenants', function () {
    [$tenancy, $tenantA, $tenantB, $patientA] = isolationFixture();

    $tenancy->run($tenantA->id, function () use ($patientA, $tenantB) {
        $patient = Patient::findOrFail($patientA->id);
        $patient->tenant_id = $tenantB->id;
        $patient->save();
    });
})->throws(LogicException::class, 'tenant_id is immutable');

it('fills tenant_id automatically from context', function () {
    [$tenancy, , $tenantB] = isolationFixture();

    $patient = $tenancy->run($tenantB->id, fn () => Patient::factory()->create());

    expect($patient->tenant_id)->toBe($tenantB->id);
});

it('refuses to create tenant data with no context', function () {
    Patient::factory()->create();
})->throws(TenantContextMissing::class);

it('restores the previous tenant after a nested run', function () {
    // set_config is transaction scoped, and a nested run() issues a SAVEPOINT
    // rather than a new transaction -- releasing which does NOT restore the
    // previous setting. Without an explicit restore the tenant would silently
    // persist and the next query would execute as the wrong tenant.
    [$tenancy, $tenantA, $tenantB, $patientA] = isolationFixture();

    $tenancy->run($tenantA->id, function () use ($tenancy, $tenantB, $patientA) {
        $tenancy->run($tenantB->id, fn () => Patient::factory()->create());

        // Back in tenant A: its patient must be visible again.
        expect(Patient::find($patientA->id))->not->toBeNull();
    });
});
