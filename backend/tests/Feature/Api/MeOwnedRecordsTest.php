<?php

use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| The records an account may act for
|--------------------------------------------------------------------------
|
| Every patient-facing action is attached to a patient RECORD rather than to a user account:
| booking takes a patient_id, and so do consents, orders and deliveries. The link lives on
| patients.user_id and nothing exposed it, so the portal could not answer "which record is
| mine" and its booking screen was a dead end that told the patient to telephone the clinic.
|
| These tests exist so that gap cannot reopen quietly. The one that matters most is the
| guardian case: ADR-0010 bought one-account-to-many-records on purpose, and a scalar would
| work for the common case while losing a child's record.
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function meUrl(Tenant $tenant): string
{
    return sprintf('http://%s.%s/api/v1/me', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST));
}

/** @return array{Tenant, User} */
function accountWithRecords(int $records): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $records) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::Patient->value);

        for ($i = 0; $i < $records; $i++) {
            Patient::factory()->create(['tenant_id' => $tenant->id, 'user_id' => $user->id]);
        }

        return $user;
    });

    return [$tenant, $user];
}

it('tells a patient which record is theirs', function () {
    [$tenant, $user] = accountWithRecords(1);

    $body = $this->actingAs($user)->getJson(meUrl($tenant))->assertOk()->json('data');

    expect($body['patient_ids'])->toHaveCount(1);
});

it('returns every record a guardian holds, not just the first', function () {
    // The cardinality ADR-0010 bought. A scalar would pass the test above and lose a child.
    [$tenant, $user] = accountWithRecords(3);

    $this->actingAs($user)->getJson(meUrl($tenant))->assertOk()
        ->assertJsonCount(3, 'data.patient_ids');
});

it('gives a member of staff an empty list rather than somebody else s record', function () {
    $tenant = Tenant::factory()->create();

    $clinician = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $clinician = User::factory()->create(['tenant_id' => $tenant->id]);
        $clinician->assignRole(ClinicalRole::Clinician->value);

        // A record exists at this clinic, and it belongs to nobody's account.
        Patient::factory()->create(['tenant_id' => $tenant->id, 'user_id' => null]);

        return $clinician;
    });

    $this->actingAs($clinician)->getJson(meUrl($tenant))->assertOk()
        ->assertJsonPath('data.patient_ids', []);
});

it('never leaks a record belonging to another clinic', function () {
    [$tenant, $user] = accountWithRecords(1);

    $other = Tenant::factory()->create();
    app(Tenancy::class)->run($other->id, fn () => Patient::factory()->create([
        'tenant_id' => $other->id,
        'user_id' => null,
    ]));

    $this->actingAs($user)->getJson(meUrl($tenant))->assertOk()
        ->assertJsonCount(1, 'data.patient_ids');
});
