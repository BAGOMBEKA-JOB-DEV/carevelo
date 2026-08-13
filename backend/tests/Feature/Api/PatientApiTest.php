<?php

use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| H2 -- patient registration
|--------------------------------------------------------------------------
|
| Registration is where DPPA 2019 compliance either happens or fails, so most of
| what follows tests what registration REFUSES to do: attach clinical data
| before consent, require a national ID, let a client set a status, or admit
| that a phone number is already on file.
|
| See docs/10-product/prd-h2-patient-registration-consent.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function h2PatientUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic and one member of its staff, in the given role.
 *
 * @return array{Tenant, User}
 */
function h2ClinicStaff(ClinicalRole $role = ClinicalRole::FrontDesk): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });

    return [$tenant, $user];
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function h2Registration(array $overrides = []): array
{
    return array_merge([
        'given_name' => 'Aisha',
        'family_name' => 'Nakato',
        'phone' => '0772 123 456',
    ], $overrides);
}

it('creates a patient in pending_consent, unable to hold clinical data', function () {
    // The state that makes the decline path safe: nothing clinical may attach
    // until a consent decision has been recorded.
    [$tenant, $staff] = h2ClinicStaff();

    $response = $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration())
        ->assertCreated()
        ->assertJsonPath('data.status', 'pending_consent');

    $id = (string) $response->json('data.id');

    // Assertions run INSIDE the tenant context. Outside it, RLS correctly hides
    // the row, which is the isolation model working rather than a bug.
    app(Tenancy::class)->run($tenant->id, function () use ($id) {
        $patient = Patient::query()->findOrFail($id);

        expect($patient->status)->toBe(PatientStatus::PendingConsent)
            ->and($patient->mayHoldClinicalData())->toBeFalse();
    });
});

it('normalises the phone number to E.164 however it was typed', function (string $written) {
    // Ugandans write the same number at least six ways. Storing them all is how
    // one person ends up with three records and misses a prescription.
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration(['phone' => $written]))
        ->assertCreated()
        ->assertJsonPath('data.phone', '+256772123456');
})->with(['0772 123 456', '+256 772 123456', '256772123456', '(+256) 772-123-456']);

it('rejects a phone number that is not a Ugandan one', function () {
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration(['phone' => '0912 000 111']))
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonValidationErrors('phone');
});

it('never requires a national id number', function () {
    // Requiring a NIN excludes patients, and exclusion is a worse outcome than
    // unverified identity. This stays true in perpetuity.
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration())
        ->assertCreated()
        ->assertJsonPath('data.national_id_number', null);
});

it('rejects a field the endpoint does not declare', function () {
    // A typo'd field name silently discarded is how a clinic discovers six
    // weeks later that something was never saved. `status` in particular must
    // never be client-settable.
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration([
            'status' => 'active',
            'guardian_nmae' => 'Typo',
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['status', 'guardian_nmae']);
});

it('requires guardian details for a patient under 18', function () {
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration([
            'date_of_birth' => now()->subYears(10)->toDateString(),
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['guardian_name', 'guardian_phone', 'guardian_relationship']);
});

it('registers a minor once a guardian is named', function () {
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration([
            'date_of_birth' => now()->subYears(10)->toDateString(),
            'guardian_name' => 'Sarah Nakato',
            'guardian_phone' => '0772 555 444',
            'guardian_relationship' => 'mother',
        ]))
        ->assertCreated()
        ->assertJsonPath('data.guardian.phone', '+256772555444');
});

it('will not let a minor lose their guardian one field at a time', function () {
    // The patch never mentions the date of birth, so judging the payload alone
    // would let the guardian details be erased without anyone noticing.
    [$tenant, $staff] = h2ClinicStaff();

    $minor = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'date_of_birth' => now()->subYears(9)->toDateString(),
        'guardian_name' => 'Sarah Nakato',
        'guardian_phone' => '+256772555444',
        'guardian_relationship' => 'mother',
    ]));

    $this->actingAs($staff)
        ->patchJson(h2PatientUrl($tenant, "/api/v1/patients/{$minor->id}"), ['guardian_phone' => null])
        ->assertStatus(422)
        ->assertJsonValidationErrors('guardian_phone');
});

it('does not reveal that a phone number is already registered', function () {
    // Confirming that a number is on file confirms that a specific person is a
    // patient of this specific clinic, which is special-category disclosure in
    // its own right. Both attempts must be indistinguishable.
    [$tenant, $staff] = h2ClinicStaff();

    $first = $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration())
        ->assertCreated();

    $second = $this->actingAs($staff)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration(['given_name' => 'Someone']))
        ->assertCreated();

    expect($second->json('data.id'))->toBe($first->json('data.id'))
        ->and($second->json())->not->toHaveKey('errors')
        ->and(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->count()))->toBe(1);
});

it('pages the patient list with a cursor, twenty-five at a time', function () {
    // Cursor, not offset: front desk pages through this while walk-ins are
    // being registered beside them, and offsets duplicate and skip rows.
    [$tenant, $staff] = h2ClinicStaff();

    app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->count(30)->create());

    $response = $this->actingAs($staff)
        ->getJson(h2PatientUrl($tenant, '/api/v1/patients'))
        ->assertOk();

    expect($response->json('data'))->toHaveCount(25)
        ->and($response->json('meta.next_cursor'))->not->toBeNull();
});

it('rejects a status filter that is not a patient status', function () {
    [$tenant, $staff] = h2ClinicStaff();

    $this->actingAs($staff)
        ->getJson(h2PatientUrl($tenant, '/api/v1/patients?status=deceased'))
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');
});

it('refuses to register a patient as a pharmacist', function () {
    // The denial test. A pharmacist reads a name and a number to hand over a
    // package; they do not open registrations.
    [$tenant, $pharmacist] = h2ClinicStaff(ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration())
        ->assertForbidden();
});

it('refuses an unauthenticated registration', function () {
    $tenant = Tenant::factory()->create();

    $this->postJson(h2PatientUrl($tenant, '/api/v1/patients'), h2Registration())
        ->assertUnauthorized();
});

it('returns 404, not 403, for a patient of another clinic', function () {
    // 403 would confirm the record exists, leaking that a named person is a
    // patient somewhere. With RLS the row simply is not there.
    $other = Tenant::factory()->create();
    [$tenant, $staff] = h2ClinicStaff();

    $stranger = app(Tenancy::class)->run($other->id, fn () => Patient::factory()->create());

    $this->actingAs($staff)
        ->getJson(h2PatientUrl($tenant, "/api/v1/patients/{$stranger->id}"))
        ->assertNotFound();
});

it('corrects a patient detail', function () {
    [$tenant, $staff] = h2ClinicStaff();

    $patient = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());

    $this->actingAs($staff)
        ->patchJson(h2PatientUrl($tenant, "/api/v1/patients/{$patient->id}"), ['district' => 'Wakiso'])
        ->assertOk()
        ->assertJsonPath('data.district', 'Wakiso');
});

it('refuses to change a discarded registration', function () {
    // Discarded is final. The record survives only to explain why service could
    // not proceed, and is purged on schedule.
    [$tenant, $staff] = h2ClinicStaff();

    $patient = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Patient::factory()->create(['status' => PatientStatus::Discarded])
    );

    $this->actingAs($staff)
        ->patchJson(h2PatientUrl($tenant, "/api/v1/patients/{$patient->id}"), ['district' => 'Wakiso'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('will not let a client set the status through an update', function () {
    [$tenant, $staff] = h2ClinicStaff();

    $patient = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Patient::factory()->pendingConsent()->create()
    );

    $this->actingAs($staff)
        ->patchJson(h2PatientUrl($tenant, "/api/v1/patients/{$patient->id}"), ['status' => 'active'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');
});
