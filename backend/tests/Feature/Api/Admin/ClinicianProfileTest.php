<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\RegistrationBody;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WorkingHour;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| H1 -- the clinical profile that makes a clinic usable
|--------------------------------------------------------------------------
|
| A staff invitation produces an account in a role. Nothing before this
| endpoint produced the Clinician row behind it, and the consequence was the
| whole patient journey: availability is generated per Clinician, so a freshly
| onboarded clinic offered no slots, nothing could be booked, no consultation
| could be held and no prescription could be issued. The onboarding checklist
| has always required "at least one registered clinician" and nothing in the
| application could tick it.
|
| The last test in this file is the one that proves the gap is closed. It asks
| for availability before and after, on the same fixture, and the answer changes
| from nothing to slots.
|
| The refusals matter as much. Recording a registration number and switching
| `can_prescribe` on IS granting the right to prescribe, which the RBAC matrix
| keeps in the clinic_admin column -- so a clinician cannot grant it to
| themselves, and another clinic's staff member is a 404 rather than a 403.
|
| See docs/10-product/prd-h1-clinic-onboarding.md sections 6 and 8 and
| docs/50-security-compliance/rbac-matrix.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/** Tenancy comes from the host. It is never a path, query or body field. */
function clinicianProfileUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function clinicianProfileStaff(Tenant $tenant, ClinicalRole $role, bool $active = true): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role, $active) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'is_active' => $active]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A clinic, its administrator, and a colleague invited into the clinician role
 * who has no clinical profile yet.
 *
 * @return array{Tenant, User, User}
 */
function clinicianProfileFixture(): array
{
    $tenant = Tenant::factory()->create();

    return [
        $tenant,
        clinicianProfileStaff($tenant, ClinicalRole::ClinicAdmin),
        clinicianProfileStaff($tenant, ClinicalRole::Clinician),
    ];
}

/** The path to one colleague's clinical profile. */
function clinicianProfilePath(User $colleague): string
{
    return '/api/v1/tenant/users/'.$colleague->id.'/clinician';
}

/**
 * The distinct clinicians a decoded availability body offers slots for.
 *
 * @return list<string>
 */
function clinicianProfileSlotOwners(mixed $slots): array
{
    $owners = [];

    foreach (is_array($slots) ? $slots : [] as $slot) {
        if (is_array($slot) && is_string($slot['clinician_id'] ?? null)) {
            $owners[$slot['clinician_id']] = true;
        }
    }

    return array_keys($owners);
}

/**
 * A complete, valid profile body.
 *
 * @return array<string, mixed>
 */
function clinicianProfileBody(): array
{
    return [
        'registration_body' => RegistrationBody::Umdpc->value,
        'registration_number' => 'UMDPC-04412',
        'specialty' => 'General Practice',
        'can_prescribe' => true,
    ];
}

// --- Creating -------------------------------------------------------------

it('creates a clinician from a colleague already invited into the role', function () {
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $response = $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), clinicianProfileBody())
        ->assertCreated()
        ->assertJsonPath('data.user_id', $colleague->id)
        ->assertJsonPath('data.name', $colleague->name)
        ->assertJsonPath('data.registration_body', RegistrationBody::Umdpc->value)
        ->assertJsonPath('data.registration_number', 'UMDPC-04412')
        ->assertJsonPath('data.can_prescribe', true)
        // Derived, and the field a console should actually render: the flag
        // alone is a half-truth while the registration number can be blank.
        ->assertJsonPath('data.may_prescribe', true)
        ->assertJsonPath('data.has_expired_licence', false);

    $clinician = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Clinician::query()->where('user_id', $colleague->id)->firstOrFail(),
    );

    expect($clinician->tenant_id)->toBe($tenant->id);
    expect($clinician->mayPrescribe())->toBeTrue();
    expect($response->json('data.id'))->toBe($clinician->id);
});

it('records the grant in the audit trail without writing the registration number into it', function () {
    // A practitioner credential in an audit trail is that credential in a second
    // place, and an audit event records that something happened to which record,
    // never what the record said. What IS recorded is the capability, because
    // "who gave this person the right to prescribe" is the question a complaint
    // actually asks.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), clinicianProfileBody())
        ->assertCreated();

    app(Tenancy::class)->run($tenant->id, function () use ($colleague) {
        $events = AuditEvent::query()->where('action', 'clinician.created')->get();

        expect($events)->toHaveCount(1);

        $metadata = (array) $events->first()?->metadata;

        expect($metadata['user_id'] ?? null)->toBe($colleague->id);
        expect($metadata['can_prescribe'] ?? null)->toBeTrue();

        $serialised = (string) json_encode($metadata);

        expect($serialised)->not->toContain('UMDPC-04412')
            ->and($serialised)->not->toContain('General Practice');
    });
});

it('rejects a register that is not one of the three', function () {
    // Captured, never verified -- but captured as one of the three registers
    // that exist, so the value on a prescription document means something.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), [
            ...clinicianProfileBody(),
            'registration_body' => 'general_medical_council',
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('refuses a second profile for the same colleague', function () {
    [$tenant, $admin, $colleague] = clinicianProfileFixture();
    $url = clinicianProfileUrl($tenant, clinicianProfilePath($colleague));

    $this->actingAs($admin)->postJson($url, clinicianProfileBody())->assertCreated();

    $this->actingAs($admin)->postJson($url, clinicianProfileBody())
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    expect(app(Tenancy::class)->run($tenant->id, fn () => Clinician::query()->count()))->toBe(1);
});

it('refuses to make a pharmacist bookable as a clinician', function () {
    // Availability is generated per Clinician row, so a registration profile on
    // a pharmacist or a receptionist would put them in the clinic's diary and
    // patients would book them.
    [$tenant, $admin] = clinicianProfileFixture();
    $pharmacist = clinicianProfileStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($pharmacist)), clinicianProfileBody())
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    expect(app(Tenancy::class)->run($tenant->id, fn () => Clinician::query()->count()))->toBe(0);
});

it('returns 404, not 403, for a patient account', function () {
    // Same answer the staff endpoints give, and the stake is higher here: a
    // Clinician row makes an account bookable, so minting one from a patient
    // account would put a patient in the clinic's availability.
    [$tenant, $admin] = clinicianProfileFixture();
    $patientAccount = clinicianProfileStaff($tenant, ClinicalRole::Patient);

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($patientAccount)), clinicianProfileBody())
        ->assertNotFound();

    expect(app(Tenancy::class)->run($tenant->id, fn () => Clinician::query()->count()))->toBe(0);
});

it('rejects a body that tries to name the clinic or the colleague', function () {
    [$tenant, $admin, $colleague] = clinicianProfileFixture();
    $otherClinic = Tenant::factory()->create();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), [
            ...clinicianProfileBody(),
            'tenant_id' => $otherClinic->id,
            'user_id' => $admin->id,
        ])
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['tenant_id', 'user_id']]);
});

// --- The registration number a clinic does not have yet -------------------

it('saves a clinician with no registration number, prescribing off', function () {
    // The PRD's own exception path: a clinic that cannot record the colleague
    // until someone finds a certificate simply does not finish onboarding.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), [
            'registration_body' => RegistrationBody::NursesMidwives->value,
            'registration_number' => '',
        ])
        ->assertCreated()
        ->assertJsonPath('data.can_prescribe', false)
        ->assertJsonPath('data.may_prescribe', false);

    $clinician = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Clinician::query()->where('user_id', $colleague->id)->firstOrFail(),
    );

    expect($clinician->mayPrescribe())->toBeFalse();
});

it('refuses prescribing rights while the registration number is blank', function () {
    // THE invariant, restated at the boundary. Nothing unsafe could reach a
    // prescription -- mayPrescribe() refuses on a blank number -- but a profile
    // stored with the flag on and no number renders as "may prescribe", and the
    // first anyone would learn otherwise is a clinician failing with a patient
    // waiting.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), [
            'registration_body' => RegistrationBody::Umdpc->value,
            // Whitespace is not a registration number.
            'registration_number' => '   ',
            'can_prescribe' => true,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    expect(app(Tenancy::class)->run($tenant->id, fn () => Clinician::query()->count()))->toBe(0);
});

it('completes a profile later, which is where the prompt leads', function () {
    [$tenant, $admin, $colleague] = clinicianProfileFixture();
    $url = clinicianProfileUrl($tenant, clinicianProfilePath($colleague));

    $this->actingAs($admin)->postJson($url, [
        'registration_body' => RegistrationBody::Ahpc->value,
        'registration_number' => '',
    ])->assertCreated();

    $this->actingAs($admin)->patchJson($url, [
        'registration_number' => 'AHPC-9981',
        'can_prescribe' => true,
    ])
        ->assertOk()
        ->assertJsonPath('data.may_prescribe', true);

    $clinician = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Clinician::query()->where('user_id', $colleague->id)->firstOrFail(),
    );

    expect($clinician->mayPrescribe())->toBeTrue();
    expect($clinician->registration_body)->toBe(RegistrationBody::Ahpc->value);
});

it('judges an update against the state it would leave behind', function () {
    // Switching prescribing on is judged against the number already stored, and
    // blanking the number is judged against the flag already set. A payload-only
    // check would let the second one through and leave the incoherent record the
    // first one refuses.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();
    $url = clinicianProfileUrl($tenant, clinicianProfilePath($colleague));

    $this->actingAs($admin)->postJson($url, clinicianProfileBody())->assertCreated();

    $this->actingAs($admin)->patchJson($url, ['registration_number' => ''])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    expect(app(Tenancy::class)->run(
        $tenant->id,
        fn () => (string) Clinician::query()->where('user_id', $colleague->id)->value('registration_number'),
    ))->toBe('UMDPC-04412');
});

it('records an expired practising licence as a warning and stores it anyway', function () {
    // Licence currency is the clinic's regulatory responsibility. Blocking care
    // on our possibly-stale copy of a register we cannot read would be the worse
    // error, so the expiry is recorded, surfaced, and never enforced.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), [
            ...clinicianProfileBody(),
            'practising_licence_expires_at' => Date::now()->subMonths(2)->toDateString(),
        ])
        ->assertCreated()
        ->assertJsonPath('data.has_expired_licence', true)
        ->assertJsonPath('data.may_prescribe', true);

    app(Tenancy::class)->run($tenant->id, function () {
        expect(AuditEvent::query()->where('action', 'clinician.licence_expired')->exists())->toBeTrue();
    });
});

// --- Who may do this ------------------------------------------------------

it('refuses every role but the administrator', function (string $role) {
    [$tenant, , $colleague] = clinicianProfileFixture();
    $actor = clinicianProfileStaff($tenant, ClinicalRole::from($role));

    $this->actingAs($actor)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), clinicianProfileBody())
        ->assertForbidden();

    expect(app(Tenancy::class)->run($tenant->id, fn () => Clinician::query()->count()))->toBe(0);
})->with([
    // The one that matters most. A clinician who could write their own
    // registration number and switch their own prescribing on would make the
    // single most important invariant in the system self-service.
    ClinicalRole::Clinician->value,
    ClinicalRole::FrontDesk->value,
    ClinicalRole::Pharmacist->value,
    ClinicalRole::Dispatcher->value,
    ClinicalRole::Rider->value,
    ClinicalRole::Patient->value,
]);

it('refuses a deactivated administrator', function () {
    [$tenant, , $colleague] = clinicianProfileFixture();
    $formerAdmin = clinicianProfileStaff($tenant, ClinicalRole::ClinicAdmin, active: false);

    $this->actingAs($formerAdmin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), clinicianProfileBody())
        ->assertForbidden();
});

it('returns 404, not 403, for another clinic\'s staff member', function () {
    // A 403 confirms the account exists, which discloses that a named person
    // works at some other clinic on Carevelo.
    [$tenant, $admin] = clinicianProfileFixture();

    $otherClinic = Tenant::factory()->create();
    $stranger = clinicianProfileStaff($otherClinic, ClinicalRole::Clinician);

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($stranger)), clinicianProfileBody())
        ->assertNotFound();

    $this->actingAs($admin)
        ->getJson(clinicianProfileUrl($tenant, clinicianProfilePath($stranger)))
        ->assertNotFound();

    expect(app(Tenancy::class)->run($otherClinic->id, fn () => Clinician::query()->count()))->toBe(0);
});

// --- Reading it back ------------------------------------------------------

it('shows the administrator the registration number they typed in', function () {
    // Not a contradiction of the patient-facing rule. GET /v1/clinicians is
    // reachable by every patient of the clinic and omits the number
    // permanently; this route is reachable by the administrator alone, and they
    // have to read back what they entered in order to correct it.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();
    $url = clinicianProfileUrl($tenant, clinicianProfilePath($colleague));

    $this->actingAs($admin)->postJson($url, clinicianProfileBody())->assertCreated();

    $this->actingAs($admin)->getJson($url)
        ->assertOk()
        ->assertJsonPath('data.registration_number', 'UMDPC-04412')
        ->assertJsonStructure([
            'data' => [
                'id', 'user_id', 'name', 'registration_body', 'registration_number',
                'specialty', 'practising_licence_expires_at', 'can_prescribe',
                'may_prescribe', 'has_expired_licence',
            ],
        ]);
});

it('leaves the patient-facing clinician list unwidened', function () {
    // The admin shape is a SEPARATE resource class, not the patient one with
    // fields switched on. This proves the two did not converge.
    [$tenant, $admin, $colleague] = clinicianProfileFixture();

    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), clinicianProfileBody())
        ->assertCreated();

    $patientUser = clinicianProfileStaff($tenant, ClinicalRole::Patient);

    $response = $this->actingAs($patientUser)
        ->getJson(clinicianProfileUrl($tenant, '/api/v1/clinicians'))
        ->assertOk()
        ->assertJsonCount(1, 'data');

    $body = (string) json_encode($response->json());

    expect($body)->not->toContain('UMDPC-04412')
        ->and($body)->not->toContain('registration_number')
        ->and($body)->not->toContain('registration_body')
        ->and($body)->not->toContain('practising_licence');
});

it('gives a patient no way to reach the profile endpoint at all', function () {
    [$tenant, , $colleague] = clinicianProfileFixture();
    $patientUser = clinicianProfileStaff($tenant, ClinicalRole::Patient);

    $this->actingAs($patientUser)
        ->getJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)))
        ->assertForbidden();
});

// --- The gap this endpoint exists to close --------------------------------

it('turns an empty availability response into bookable slots', function () {
    // THE test. Everything else here is a rule about how a clinician is
    // recorded; this is the reason the endpoint had to exist.
    //
    // Before: a clinic with branding, a service and working hours, and staff
    // invited into the clinician role -- and no bookable moment anywhere,
    // because availability is generated per Clinician row and there were none.
    $tenant = Tenant::factory()->create();
    $admin = clinicianProfileStaff($tenant, ClinicalRole::ClinicAdmin);
    $colleague = clinicianProfileStaff($tenant, ClinicalRole::Clinician);
    $patientUser = clinicianProfileStaff($tenant, ClinicalRole::Patient);

    $service = app(Tenancy::class)->run($tenant->id, function () {
        foreach (range(0, 6) as $day) {
            WorkingHour::factory()->forDay($day)->opening('08:00:00', '12:00:00')->create();
        }

        return Service::factory()->create(['duration_minutes' => 30]);
    });

    $availability = clinicianProfileUrl($tenant, '/api/v1/availability?service_id='.$service->id);

    expect($this->actingAs($patientUser)->getJson($availability)->assertOk()->json('data'))->toBe([]);

    // The onboarding checklist agrees that the clinic is not ready.
    $checklist = $this->actingAs($admin)
        ->getJson(clinicianProfileUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
        ->assertOk()
        ->json('data.items');

    expect(h1ChecklistByKey($checklist)['clinicians']['is_complete'] ?? null)->toBeFalse();

    // After: one POST, and the clinic can be booked.
    $this->actingAs($admin)
        ->postJson(clinicianProfileUrl($tenant, clinicianProfilePath($colleague)), clinicianProfileBody())
        ->assertCreated();

    $slots = $this->actingAs($patientUser)->getJson($availability)->assertOk()->json('data');

    expect($slots)->not->toBeEmpty();

    $clinician = app(Tenancy::class)->run(
        $tenant->id,
        fn () => Clinician::query()->where('user_id', $colleague->id)->firstOrFail(),
    );

    expect(clinicianProfileSlotOwners($slots))->toBe([$clinician->id]);

    $checklist = $this->actingAs($admin)
        ->getJson(clinicianProfileUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
        ->assertOk()
        ->json('data.items');

    expect(h1ChecklistByKey($checklist)['clinicians']['is_complete'] ?? null)->toBeTrue();
});
