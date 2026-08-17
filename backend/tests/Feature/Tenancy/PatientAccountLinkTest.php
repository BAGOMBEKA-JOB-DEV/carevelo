<?php

use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The patient-account link
|--------------------------------------------------------------------------
|
| patients.user_id is what lets the API answer "is this the patient of that
| appointment", and therefore what every `P own` endpoint in the catalogue rests
| on. Before it existed a patient user was denied everywhere.
|
| The guarantees asserted here are structural, not behavioural, which is why they
| are tested against the database rather than through a controller:
|
|   1. The link cannot cross a tenant. users is platform-scoped and has no RLS,
|      so unlike every other reference in this schema the database is the ONLY
|      thing that can refuse a foreign clinic's account.
|   2. Deleting the account releases the link and leaves the record's tenant
|      alone -- see the migration for why that is not the default behaviour.
|   3. One account may hold several records, because guardians exist.
|
| @see docs/70-decisions/0010-patient-account-link.md
|
*/

it('refuses to link a patient record to an account at another clinic', function () {
    // The composite foreign key is the whole control. A plain user_id column
    // would accept this row, and no policy would ever see it.
    $clinicA = Tenant::factory()->create();
    $clinicB = Tenant::factory()->create();

    $accountAtB = User::factory()->create(['tenant_id' => $clinicB->id]);

    // The update runs INSIDE clinic A's context on purpose. Outside it, RLS hides
    // the row and the statement matches nothing -- which looks like the foreign
    // key refusing the link while actually proving nothing about it.
    expect(fn () => app(Tenancy::class)->run($clinicA->id, function () use ($accountAtB) {
        $patient = Patient::factory()->create();

        DB::table('patients')
            ->where('id', $patient->id)
            ->update(['user_id' => $accountAtB->id]);
    }))->toThrow(QueryException::class);
});

it('links a patient record to an account at the same clinic', function () {
    $tenant = Tenant::factory()->create();
    $account = User::factory()->create(['tenant_id' => $tenant->id]);

    $patient = app(Tenancy::class)->run($tenant->id, function () use ($account) {
        $patient = Patient::factory()->create();
        $patient->user_id = $account->id;
        $patient->save();

        return $patient->fresh();
    });

    expect($patient?->user_id)->toBe($account->id)
        ->and($patient?->isClaimed())->toBeTrue();
});

it('releases the link when the account is deleted, and keeps the record where it is', function () {
    // ON DELETE SET NULL (user_id), not the plain composite form, which would
    // also null tenant_id -- a NOT NULL column, and the one RLS is keyed on.
    // The medical record outlives the login.
    $tenant = Tenant::factory()->create();
    $account = User::factory()->create(['tenant_id' => $tenant->id]);

    $patientId = app(Tenancy::class)->run($tenant->id, function () use ($account) {
        $patient = Patient::factory()->create();
        $patient->user_id = $account->id;
        $patient->save();

        return $patient->id;
    });

    $account->delete();

    $row = app(Tenancy::class)->run($tenant->id, fn () => DB::selectOne(
        'select user_id, tenant_id from patients where id = ?',
        [$patientId]
    ));

    expect($row)->not->toBeNull()
        ->and($row->user_id)->toBeNull()
        ->and($row->tenant_id)->toBe($tenant->id);
});

it('lets one account hold several patient records, for a guardian', function () {
    $this->seed(RoleSeeder::class);

    $tenant = Tenant::factory()->create();
    $guardian = User::factory()->create(['tenant_id' => $tenant->id]);
    $guardian->assignRole(ClinicalRole::Patient->value);

    app(Tenancy::class)->run($tenant->id, function () use ($guardian) {
        foreach (range(1, 3) as $i) {
            $child = Patient::factory()->create(['phone' => '+2567720000'.$i.'0']);
            $child->user_id = $guardian->id;
            $child->save();
        }
    });

    $owned = app(Tenancy::class)->run($tenant->id, fn () => $guardian->ownedPatientIds());

    expect($owned)->toHaveCount(3);
});

it('owns nothing when the record id is unknown or null', function () {
    // owns(null) must be false. A null means the caller could not work out whose
    // record it is, and that has to fail closed.
    $tenant = Tenant::factory()->create();
    $account = User::factory()->create(['tenant_id' => $tenant->id]);

    app(Tenancy::class)->run($tenant->id, function () use ($account) {
        expect($account->owns(null))->toBeFalse()
            ->and($account->owns('01HZZZZZZZZZZZZZZZZZZZZZZZ'))->toBeFalse();
    });
});
