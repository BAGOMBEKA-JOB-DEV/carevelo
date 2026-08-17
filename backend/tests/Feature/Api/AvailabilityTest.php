<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WorkingHour;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Availability, and the patient-facing clinician list
|--------------------------------------------------------------------------
|
| Availability is the intersection of three facts: the clinic is open, the
| clinician is free, and the service takes a known length of time. The test
| that matters most is the second one -- a slot already held by a confirmed
| appointment must be ABSENT, because offering it means two patients waiting on
| the same call.
|
| The clinician list is a disclosure test. It carries a name, a specialty and a
| photo; the registration number never appears, and the assertion below proves
| it rather than trusting the resource.
|
| Working hours are wall-clock facts in the clinic's own timezone, so every
| fixture here is built in that timezone. A test whose fixtures are all in UTC
| would pass against a UTC implementation and mis-schedule every real clinic.
|
| @see docs/10-product/prd-h3-teleconsultation.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function availabilityUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic open 08:00-12:00 every day, one clinician, one half-hour service.
 *
 * Every day of the week is configured so the fixture does not depend on which
 * day the suite happens to run.
 *
 * @return array{
 *     tenant: Tenant,
 *     admin: User,
 *     patientUser: User,
 *     rider: User,
 *     clinician: Clinician,
 *     service: Service,
 *     timezone: string,
 * }
 */
function availabilityFixture(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $staff = function (ClinicalRole $role) use ($tenant): User {
            $user = User::factory()->create(['tenant_id' => $tenant->id]);
            $user->assignRole($role->value);

            return $user;
        };

        foreach (range(0, 6) as $day) {
            WorkingHour::factory()->forDay($day)->opening('08:00:00', '12:00:00')->create();
        }

        return [
            'tenant' => $tenant,
            'admin' => $staff(ClinicalRole::ClinicAdmin),
            'patientUser' => $staff(ClinicalRole::Patient),
            'rider' => $staff(ClinicalRole::Rider),
            'clinician' => Clinician::factory()->create(),
            'service' => Service::factory()->create(['duration_minutes' => 30]),
            'timezone' => (string) $tenant->timezone,
        ];
    });
}

/**
 * Tomorrow at a given clinic-local time.
 *
 * Tomorrow rather than today so the fixture never lands in the past, which
 * availability correctly refuses to offer.
 */
function clinicLocal(string $timezone, int $hour, int $minute = 0): Carbon
{
    return Date::now($timezone)->addDay()->setTime($hour, $minute)->startOfMinute();
}

it('offers slots the length of the service, inside the clinic\'s opening hours', function () {
    $f = availabilityFixture();
    $day = clinicLocal($f['timezone'], 8)->toDateString();

    $response = $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
            $f['service']->id,
            $f['clinician']->id,
            $day,
            $day,
        )))
        ->assertOk()
        ->assertJsonPath('meta.duration_minutes', 30)
        ->assertJsonPath('meta.timezone', $f['timezone']);

    // 08:00 to 12:00 in half-hour slots is eight.
    expect($response->json('data'))->toHaveCount(8);

    $starts = array_column((array) $response->json('data'), 'starts_at');

    expect($starts)->toContain(clinicLocal($f['timezone'], 8)->toIso8601String())
        // The last slot that fits ends exactly at closing.
        ->and($starts)->toContain(clinicLocal($f['timezone'], 11, 30)->toIso8601String())
        // Nothing runs past closing.
        ->and($starts)->not->toContain(clinicLocal($f['timezone'], 12)->toIso8601String());
});

it('omits a slot a confirmed appointment already holds', function () {
    // THE availability test. A double-offered slot means one of two patients
    // waits alone on a call they paid for.
    $f = availabilityFixture();

    $taken = clinicLocal($f['timezone'], 9);

    app(Tenancy::class)->run($f['tenant']->id, fn () => Appointment::factory()->create([
        'clinician_id' => $f['clinician']->id,
        'service_id' => $f['service']->id,
        'scheduled_start_at' => $taken,
        'scheduled_end_at' => $taken->copy()->addMinutes(30),
        'status' => AppointmentStatus::Confirmed,
    ]));

    $day = $taken->toDateString();

    $response = $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
            $f['service']->id,
            $f['clinician']->id,
            $day,
            $day,
        )))
        ->assertOk();

    $starts = array_column((array) $response->json('data'), 'starts_at');

    expect($starts)->not->toContain($taken->toIso8601String())
        ->and($starts)->toHaveCount(7)
        // The slots either side are untouched: half-open comparison, so an
        // appointment ending at 09:30 does not consume the 09:30 slot.
        ->and($starts)->toContain(clinicLocal($f['timezone'], 8, 30)->toIso8601String())
        ->and($starts)->toContain(clinicLocal($f['timezone'], 9, 30)->toIso8601String());
});

it('keeps a slot held by an unpaid booking out of availability too', function () {
    // Consistency with booking, which holds the slot while the patient
    // completes a mobile-money prompt. Offering it here would send a second
    // patient into a rejection at the last step.
    $f = availabilityFixture();

    $taken = clinicLocal($f['timezone'], 10);

    app(Tenancy::class)->run($f['tenant']->id, fn () => Appointment::factory()->awaitingPayment()->create([
        'clinician_id' => $f['clinician']->id,
        'service_id' => $f['service']->id,
        'scheduled_start_at' => $taken,
        'scheduled_end_at' => $taken->copy()->addMinutes(30),
    ]));

    $day = $taken->toDateString();

    $response = $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
            $f['service']->id,
            $f['clinician']->id,
            $day,
            $day,
        )))
        ->assertOk();

    expect(array_column((array) $response->json('data'), 'starts_at'))
        ->not->toContain($taken->toIso8601String());
});

it('gives the slot back once the appointment is cancelled', function () {
    $f = availabilityFixture();

    $taken = clinicLocal($f['timezone'], 9);

    app(Tenancy::class)->run($f['tenant']->id, fn () => Appointment::factory()->create([
        'clinician_id' => $f['clinician']->id,
        'service_id' => $f['service']->id,
        'scheduled_start_at' => $taken,
        'scheduled_end_at' => $taken->copy()->addMinutes(30),
        'status' => AppointmentStatus::Cancelled,
    ]));

    $day = $taken->toDateString();

    $response = $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
            $f['service']->id,
            $f['clinician']->id,
            $day,
            $day,
        )))
        ->assertOk();

    expect(array_column((array) $response->json('data'), 'starts_at'))
        ->toContain($taken->toIso8601String());
});

it('offers nothing on a day the clinic is closed', function () {
    $f = availabilityFixture();

    $day = clinicLocal($f['timezone'], 8);

    app(Tenancy::class)->run($f['tenant']->id, function () use ($day) {
        WorkingHour::query()->where('day_of_week', $day->dayOfWeek)->firstOrFail()
            ->update(['is_closed' => true]);
    });

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
            $f['service']->id,
            $f['clinician']->id,
            $day->toDateString(),
            $day->toDateString(),
        )))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('offers nothing when the clinic has set no hours at all', function () {
    // A clinic mid-onboarding. Silence is the honest answer -- inventing
    // nine-to-five would publish slots nobody staffs.
    $f = availabilityFixture();

    app(Tenancy::class)->run($f['tenant']->id, fn () => WorkingHour::query()->delete());

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s',
            $f['service']->id,
        )))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('sizes slots from the service, so a longer service yields fewer', function () {
    $f = availabilityFixture();

    $long = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Service::factory()->create(['duration_minutes' => 60]),
    );

    $day = clinicLocal($f['timezone'], 8)->toDateString();

    // 08:00-12:00 in hour-long slots is four.
    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
            $long->id,
            $f['clinician']->id,
            $day,
            $day,
        )))
        ->assertOk()
        ->assertJsonCount(4, 'data')
        ->assertJsonPath('meta.duration_minutes', 60);
});

it('covers every clinician when none is named', function () {
    $f = availabilityFixture();

    $second = app(Tenancy::class)->run($f['tenant']->id, fn () => Clinician::factory()->create());

    $day = clinicLocal($f['timezone'], 8)->toDateString();

    $response = $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&from=%s&to=%s',
            $f['service']->id,
            $day,
            $day,
        )))
        ->assertOk();

    $clinicianIds = array_unique(array_column((array) $response->json('data'), 'clinician_id'));

    expect($clinicianIds)->toHaveCount(2)
        ->and($clinicianIds)->toContain($f['clinician']->id)
        ->and($clinicianIds)->toContain($second->id);
});

it('never offers a slot in the past', function () {
    // Yesterday is open on the timetable and unbookable in reality.
    $f = availabilityFixture();

    $yesterday = Date::now($f['timezone'])->subDay()->toDateString();

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], sprintf(
            '/api/v1/availability?service_id=%s&from=%s&to=%s',
            $f['service']->id,
            $yesterday,
            $yesterday,
        )))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('refuses availability for a withdrawn service', function () {
    // Deactivated means unbookable. Reporting availability for it would walk a
    // patient up to a rejection.
    $f = availabilityFixture();

    $withdrawn = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Service::factory()->create(['is_active' => false]),
    );

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], "/api/v1/availability?service_id={$withdrawn->id}"))
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['service_id']]);
});

it('requires a service to compute availability against', function () {
    $f = availabilityFixture();

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], '/api/v1/availability'))
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['service_id']]);
});

it('refuses availability to a role with no scheduling business', function () {
    $f = availabilityFixture();

    $this->actingAs($f['rider'])
        ->getJson(availabilityUrl($f['tenant'], "/api/v1/availability?service_id={$f['service']->id}"))
        ->assertForbidden();
});

it('gives a patient a clinician\'s name and specialty and never the registration number', function () {
    // THE disclosure test for this endpoint. A patient is choosing a person,
    // not auditing a register, and a harvestable list of practitioner
    // credentials reachable by every patient of every clinic invites
    // impersonation.
    $f = availabilityFixture();

    $registration = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => (string) $f['clinician']->registration_number,
    );

    expect($registration)->not->toBe('');

    $response = $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], '/api/v1/clinicians'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonStructure(['data' => [['id', 'name', 'specialty', 'photo_url']]])
        ->assertJsonPath('data.0.specialty', 'General Practice');

    $body = (string) json_encode($response->json());

    expect($body)->not->toContain($registration)
        ->and($body)->not->toContain('registration_number')
        ->and($body)->not->toContain('registration_body')
        // Nor our unverified copy of the licence expiry: showing it would read
        // as a verification Carevelo never performed.
        ->and($body)->not->toContain('practising_licence');
});

it('withholds the registration number from staff on this endpoint too', function () {
    // It is not a role-based redaction. The field is absent from the resource,
    // so no caller can ask for it here. Where a registration number is legally
    // required it is snapshotted onto the prescription.
    $f = availabilityFixture();

    $registration = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => (string) $f['clinician']->registration_number,
    );

    $response = $this->actingAs($f['admin'])
        ->getJson(availabilityUrl($f['tenant'], '/api/v1/clinicians'))
        ->assertOk();

    expect((string) json_encode($response->json()))->not->toContain($registration);
});

it('leaves a departed clinician off the list', function () {
    // A deactivated staff account means they have left. Listing them lets a
    // patient book someone who will not be there.
    $f = availabilityFixture();

    app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $f['clinician']->user()->firstOrFail()->update(['is_active' => false]);
    });

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], '/api/v1/clinicians'))
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('never lists another clinic\'s clinicians', function () {
    // There is no platform-level clinician and no cross-clinic directory.
    $f = availabilityFixture();
    $other = availabilityFixture();

    $this->actingAs($f['patientUser'])
        ->getJson(availabilityUrl($f['tenant'], '/api/v1/clinicians'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $f['clinician']->id);

    $this->actingAs($other['patientUser'])
        ->getJson(availabilityUrl($other['tenant'], '/api/v1/clinicians'))
        ->assertOk()
        ->assertJsonPath('data.0.id', $other['clinician']->id);
});

it('refuses the clinician list to a rider', function () {
    $f = availabilityFixture();

    $this->actingAs($f['rider'])
        ->getJson(availabilityUrl($f['tenant'], '/api/v1/clinicians'))
        ->assertForbidden();
});
