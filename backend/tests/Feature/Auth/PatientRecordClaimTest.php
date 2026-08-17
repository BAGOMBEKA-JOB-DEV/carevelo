<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\PatientRecordClaims;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Claiming a patient record
|--------------------------------------------------------------------------
|
| The step that makes the patient-account link real. Front desk registers a
| walk-in against a phone number long before that person has any login, so the
| record and the account exist independently and something has to join them.
|
| Without this the link is a column nothing ever fills, and every `P own` endpoint
| returns an empty list to a patient who plainly has records. The column shipped
| before this did -- which is why there is a test asserting the wiring, not only
| the service.
|
| THE VERIFIED PHONE IS THE PROOF. Claiming grants a human being sight of a
| medical record, so it may only follow a one-time code that proved control of the
| handset.
|
| @see docs/70-decisions/0010-patient-account-link.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/**
 * @return array{Tenant, User}
 */
function claimAccount(string $phone, ClinicalRole $role = ClinicalRole::Patient, bool $verified = true): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $phone, $role, $verified) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => $phone,
            'phone_verified_at' => $verified ? Date::now() : null,
        ]);
        $user->assignRole($role->value);

        return $user;
    });

    return [$tenant, $user];
}

it('attaches a record registered against the same verified number', function () {
    [$tenant, $user] = claimAccount('+256772000501');

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'phone' => '+256772000501',
    ]));

    $claimed = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($user));

    expect($claimed)->toBe(1)
        ->and(app(Tenancy::class)->run($tenant->id, fn () => $user->fresh()?->ownedPatientIds()))
        ->toHaveCount(1);
});

it('attaches every record registered against a guardian\'s number', function () {
    // A parent whose children were each registered against their handset. This is
    // why ADR-0010 chose one-to-many.
    [$tenant, $guardian] = claimAccount('+256772000502');

    app(Tenancy::class)->run($tenant->id, function () {
        Patient::factory()->create(['phone' => '+256772000502']);
    });

    $claimed = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($guardian));

    expect($claimed)->toBe(1);
});

it('refuses to claim on an unverified number', function () {
    // The whole control. A number typed at a front desk proves nothing, and this
    // grants sight of a medical record.
    [$tenant, $user] = claimAccount('+256772000503', verified: false);

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'phone' => '+256772000503',
    ]));

    $claimed = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($user));

    expect($claimed)->toBe(0);
});

it('does not claim records for a staff account', function () {
    // A clinician signing in must not acquire a patient record through a side door
    // no policy inspects.
    [$tenant, $clinician] = claimAccount('+256772000504', ClinicalRole::Clinician);

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'phone' => '+256772000504',
    ]));

    $claimed = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($clinician));

    expect($claimed)->toBe(0);
});

it('never reassigns a record already held by another account', function () {
    // A phone number changing hands is a real event. Moving a medical record on
    // the strength of it is a decision for clinic staff, not a side effect of
    // somebody signing in.
    [$tenant, $first] = claimAccount('+256772000505');

    app(Tenancy::class)->run($tenant->id, function () use ($first) {
        $record = Patient::factory()->create(['phone' => '+256772000505']);
        $record->user_id = $first->id;
        $record->save();
    });

    $second = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        // Same number, so the old account had to be released first; the record
        // must still not follow the number to whoever holds it now.
        $first = User::query()->where('phone', '+256772000505')->firstOrFail();
        $first->forceFill(['phone' => '+256772000599'])->save();

        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => '+256772000505',
            'phone_verified_at' => Date::now(),
        ]);
        $user->assignRole(ClinicalRole::Patient->value);

        return $user;
    });

    $claimed = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($second));

    expect($claimed)->toBe(0)
        ->and(app(Tenancy::class)->run($tenant->id, fn () => $second->ownedPatientIds()))->toBeEmpty();
});

it('never reaches across clinics', function () {
    [$tenantA, $user] = claimAccount('+256772000506');
    $tenantB = Tenant::factory()->create();

    // The same person at another clinic is a different patient record, and this
    // account has no business with it.
    app(Tenancy::class)->run($tenantB->id, fn () => Patient::factory()->create([
        'phone' => '+256772000506',
    ]));

    $claimed = app(Tenancy::class)->run($tenantA->id, fn () => app(PatientRecordClaims::class)->attach($user));

    expect($claimed)->toBe(0);
});

it('audits each record claimed, individually', function () {
    // "Who can read my records, and since when" has to be answerable per record,
    // not per sign-in.
    [$tenant, $user] = claimAccount('+256772000507');

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'phone' => '+256772000507',
    ]));

    app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($user));

    $actions = app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::query()->pluck('action')->all());

    expect($actions)->toContain('patient.record_claimed');
});

it('is idempotent across repeated sign-ins', function () {
    [$tenant, $user] = claimAccount('+256772000508');

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'phone' => '+256772000508',
    ]));

    $first = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($user));
    $second = app(Tenancy::class)->run($tenant->id, fn () => app(PatientRecordClaims::class)->attach($user));

    expect($first)->toBe(1)
        ->and($second)->toBe(0);
});
