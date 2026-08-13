<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\ConsultationMode;
use App\Models\Patient;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| H3 booking
|--------------------------------------------------------------------------
|
| The behaviours here are the ones an implementation quietly drops: the
| double-booking rejection, the difference between the two payment
| expectations, the audited staff deferral, and voice and chat being real
| choices rather than what you get when video fails.
|
| Every fixture and every assertion that touches tenant data runs inside
| Tenancy::run(). Outside it row-level security correctly hides the rows, and a
| test asserting on an empty result set is a test asserting nothing.
|
| @see docs/10-product/prd-h3-teleconsultation.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function appointmentUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic with one clinician, one patient, one service and staff to book with.
 *
 * @return array{
 *     tenant: Tenant,
 *     admin: User,
 *     frontDesk: User,
 *     patient: Patient,
 *     clinician: Clinician,
 *     service: Service,
 * }
 */
function bookingFixture(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $staff = function (ClinicalRole $role) use ($tenant): User {
            $user = User::factory()->create(['tenant_id' => $tenant->id]);
            $user->assignRole($role->value);

            return $user;
        };

        return [
            'tenant' => $tenant,
            'admin' => $staff(ClinicalRole::ClinicAdmin),
            'frontDesk' => $staff(ClinicalRole::FrontDesk),
            'patient' => Patient::factory()->create(),
            'clinician' => Clinician::factory()->create(),
            'service' => Service::factory()->create(['duration_minutes' => 30]),
        ];
    });
}

/**
 * @param  array{
 *     tenant: Tenant,
 *     admin: User,
 *     frontDesk: User,
 *     patient: Patient,
 *     clinician: Clinician,
 *     service: Service,
 * }  $fixture
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function bookingPayload(array $fixture, array $overrides = []): array
{
    return array_merge([
        'patient_id' => $fixture['patient']->id,
        'clinician_id' => $fixture['clinician']->id,
        'service_id' => $fixture['service']->id,
        'scheduled_start_at' => now()->addDay()->setTime(9, 0)->toIso8601String(),
        'mode_booked' => ConsultationMode::Video->value,
        'payment_expectation' => 'pay_at_clinic',
    ], $overrides);
}

it('confirms a pay-at-clinic booking directly and gives it an APT reference', function () {
    $f = bookingFixture();

    $response = $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated()
        ->assertJsonPath('data.status', AppointmentStatus::Confirmed->value)
        ->assertJsonPath('data.payment_expectation', 'pay_at_clinic');

    expect($response->json('data.reference'))->toStartWith('APT-');

    // The slot end comes from the service's own duration when the client does
    // not supply one.
    expect($response->json('data.scheduled_end_at'))
        ->toBe(now()->addDay()->setTime(9, 30)->toIso8601String());
});

it('opens a prepaid booking in awaiting_payment', function () {
    // Carevelo holds no funds and cannot know the patient has paid. The
    // appointment waits for a succeeded PaymentIntent or an audited deferral.
    $f = bookingFixture();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'payment_expectation' => 'prepaid',
        ]))
        ->assertCreated()
        ->assertJsonPath('data.status', AppointmentStatus::AwaitingPayment->value);
});

it('accepts voice and chat as first-class modes', function (string $mode) {
    // Not fallbacks. A patient who knows their connection is poor must be able
    // to CHOOSE voice rather than fight a failing video call.
    $f = bookingFixture();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'mode_booked' => $mode,
            'scheduled_start_at' => now()->addDays(2)->setTime(11, 0)->toIso8601String(),
        ]))
        ->assertCreated()
        ->assertJsonPath('data.mode_booked', $mode);
})->with(['voice', 'chat']);

it('rejects a second confirmed appointment overlapping the same clinician', function () {
    // Acceptance criterion 8. A double-booked clinician means one of two
    // patients waits alone on a call they paid for.
    $f = bookingFixture();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            // Starts fifteen minutes into the existing half-hour slot.
            'scheduled_start_at' => now()->addDay()->setTime(9, 15)->toIso8601String(),
        ]))
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonPath('errors.scheduled_start_at.0', 'This slot is no longer available.');

    app(Tenancy::class)->run($f['tenant']->id, function () {
        expect(Appointment::query()->count())->toBe(1);
    });
});

it('allows a back-to-back slot that only touches at the boundary', function () {
    $f = bookingFixture();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'scheduled_start_at' => now()->addDay()->setTime(9, 30)->toIso8601String(),
        ]))
        ->assertCreated();
});

it('allows the same slot for a different clinician', function () {
    $f = bookingFixture();

    $other = app(Tenancy::class)->run($f['tenant']->id, fn () => Clinician::factory()->create());

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'clinician_id' => $other->id,
        ]))
        ->assertCreated();
});

it('releases the slot when an appointment is cancelled', function () {
    $f = bookingFixture();

    $first = $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated();

    $this->actingAs($f['frontDesk'])
        ->postJson(
            appointmentUrl($f['tenant'], "/api/v1/appointments/{$first->json('data.id')}/cancel"),
            ['reason' => 'Patient asked to rebook']
        )
        ->assertOk()
        ->assertJsonPath('data.status', AppointmentStatus::Cancelled->value);

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated();
});

it('requires a reason to cancel', function () {
    $f = bookingFixture();

    $appointment = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Appointment::factory()->create([
            'patient_id' => $f['patient']->id,
            'clinician_id' => $f['clinician']->id,
            'service_id' => $f['service']->id,
        ]),
    );

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], "/api/v1/appointments/{$appointment->id}/cancel"), [])
        ->assertStatus(422)
        ->assertJsonPath('errors.reason.0', 'Say why this appointment is being cancelled.');
});

it('refuses to cancel an appointment that has already completed', function () {
    $f = bookingFixture();

    $appointment = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Appointment::factory()->create([
            'patient_id' => $f['patient']->id,
            'clinician_id' => $f['clinician']->id,
            'service_id' => $f['service']->id,
            'status' => AppointmentStatus::Completed,
        ]),
    );

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], "/api/v1/appointments/{$appointment->id}/cancel"), [
            'reason' => 'Booked by mistake',
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('keeps the cancellation reason out of the audit event', function () {
    // The reason is free text typed by a receptionist or a patient and
    // routinely names a condition. An audit event records THAT something
    // happened to WHICH record, never what the record said.
    $f = bookingFixture();

    $booking = $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertCreated();

    $this->actingAs($f['frontDesk'])
        ->postJson(
            appointmentUrl($f['tenant'], "/api/v1/appointments/{$booking->json('data.id')}/cancel"),
            ['reason' => 'Her malaria cleared up']
        )
        ->assertOk();

    app(Tenancy::class)->run($f['tenant']->id, function () {
        $event = AuditEvent::query()->where('action', 'appointment.cancelled')->firstOrFail();

        expect(json_encode($event->metadata))->not->toContain('malaria')
            ->and($event->metadata)->toHaveKey('previous_status');
    });
});

it('lets an administrator confirm an unpaid appointment, and audits it', function () {
    $f = bookingFixture();

    $booking = $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'payment_expectation' => 'prepaid',
        ]))
        ->assertCreated();

    $id = $booking->json('data.id');

    $this->actingAs($f['admin'])
        ->postJson(appointmentUrl($f['tenant'], "/api/v1/appointments/{$id}/confirm-deferred"))
        ->assertOk()
        ->assertJsonPath('data.status', AppointmentStatus::Confirmed->value);

    app(Tenancy::class)->run($f['tenant']->id, function () use ($id) {
        $event = AuditEvent::query()
            ->where('action', 'appointment.confirmed_deferred')
            ->where('subject_id', $id)
            ->firstOrFail();

        expect($event->metadata['previous_status'] ?? null)
            ->toBe(AppointmentStatus::AwaitingPayment->value);
    });
});

it('refuses a deferred confirmation to anyone but an administrator', function () {
    // Denial is the half that catches privilege escalation. An unaudited way
    // for any staff member to mark something paid is an invitation.
    $f = bookingFixture();

    $booking = $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'payment_expectation' => 'prepaid',
        ]))
        ->assertCreated();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl(
            $f['tenant'],
            "/api/v1/appointments/{$booking->json('data.id')}/confirm-deferred"
        ))
        ->assertForbidden();
});

it('refuses a deferred confirmation into a slot another appointment has taken', function () {
    $f = bookingFixture();

    $unpaid = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Appointment::factory()->awaitingPayment()->create([
            'patient_id' => $f['patient']->id,
            'clinician_id' => $f['clinician']->id,
            'service_id' => $f['service']->id,
            'scheduled_start_at' => now()->addDay()->setTime(9, 0),
            'scheduled_end_at' => now()->addDay()->setTime(9, 30),
        ]),
    );

    // A confirmed appointment lands on the same slot while the first sits unpaid.
    app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Appointment::factory()->create([
            'patient_id' => $f['patient']->id,
            'clinician_id' => $f['clinician']->id,
            'service_id' => $f['service']->id,
            'scheduled_start_at' => now()->addDay()->setTime(9, 15),
            'scheduled_end_at' => now()->addDay()->setTime(9, 45),
        ]),
    );

    $this->actingAs($f['admin'])
        ->postJson(appointmentUrl($f['tenant'], "/api/v1/appointments/{$unpaid->id}/confirm-deferred"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('filters the schedule by status, clinician and date window', function () {
    $f = bookingFixture();

    $other = app(Tenancy::class)->run($f['tenant']->id, fn () => Clinician::factory()->create());

    app(Tenancy::class)->run($f['tenant']->id, function () use ($f, $other) {
        $base = [
            'patient_id' => $f['patient']->id,
            'service_id' => $f['service']->id,
        ];

        Appointment::factory()->create($base + [
            'clinician_id' => $f['clinician']->id,
            'scheduled_start_at' => now()->addDay()->setTime(9, 0),
            'scheduled_end_at' => now()->addDay()->setTime(9, 30),
        ]);

        Appointment::factory()->awaitingPayment()->create($base + [
            'clinician_id' => $f['clinician']->id,
            'scheduled_start_at' => now()->addDay()->setTime(11, 0),
            'scheduled_end_at' => now()->addDay()->setTime(11, 30),
        ]);

        Appointment::factory()->create($base + [
            'clinician_id' => $other->id,
            'scheduled_start_at' => now()->addDays(30)->setTime(9, 0),
            'scheduled_end_at' => now()->addDays(30)->setTime(9, 30),
        ]);
    });

    $url = appointmentUrl($f['tenant'], '/api/v1/appointments');

    $this->actingAs($f['admin'])->getJson($url.'?status=confirmed')
        ->assertOk()
        ->assertJsonCount(2, 'data');

    $this->actingAs($f['admin'])->getJson($url."?clinician_id={$f['clinician']->id}")
        ->assertOk()
        ->assertJsonCount(2, 'data');

    $this->actingAs($f['admin'])->getJson($url.'?from='.now()->addDay()->toDateString().'&to='.now()->addDay()->toDateString())
        ->assertOk()
        ->assertJsonCount(2, 'data');

    $this->actingAs($f['admin'])->getJson($url.'?status=not_a_status')
        ->assertStatus(422);
});

it('rejects a booking for a patient of another clinic', function () {
    // Not "forbidden" -- not found. Confirming that the id exists somewhere
    // would leak that a person is a patient of some other clinic, which is
    // itself health information under DPPA 2019.
    $f = bookingFixture();

    $otherTenant = Tenant::factory()->create();
    $foreignPatient = app(Tenancy::class)->run($otherTenant->id, fn () => Patient::factory()->create());

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'patient_id' => $foreignPatient->id,
        ]))
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['patient_id']]);
});

it('returns 404 for an appointment belonging to another clinic', function () {
    $f = bookingFixture();

    $otherTenant = Tenant::factory()->create();
    $foreign = app(Tenancy::class)->run($otherTenant->id, fn () => Appointment::factory()->create());

    $this->actingAs($f['admin'])
        ->getJson(appointmentUrl($f['tenant'], "/api/v1/appointments/{$foreign->id}"))
        ->assertNotFound();
});

it('rejects a body field the endpoint does not know about', function () {
    // A silently discarded typo is how a clinic discovers six weeks later that
    // something was never saved.
    $f = bookingFixture();

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f, [
            'tenant_id' => $f['tenant']->id,
        ]))
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['tenant_id']]);
});

it('refuses a booking in a mode the clinic does not offer for that service', function () {
    $f = bookingFixture();

    app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $f['service']->update(['modes' => ['in_person']]);
    });

    $this->actingAs($f['frontDesk'])
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['mode_booked']]);
});

it('refuses booking to a role with no scheduling business', function () {
    $f = bookingFixture();

    $rider = app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $user = User::factory()->create(['tenant_id' => $f['tenant']->id]);
        $user->assignRole(ClinicalRole::Rider->value);

        return $user;
    });

    $this->actingAs($rider)
        ->postJson(appointmentUrl($f['tenant'], '/api/v1/appointments'), bookingPayload($f))
        ->assertForbidden();

    $this->actingAs($rider)
        ->getJson(appointmentUrl($f['tenant'], '/api/v1/appointments'))
        ->assertForbidden();
});
