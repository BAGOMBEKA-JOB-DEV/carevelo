<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Tenancy\Tenancy;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Closing a consultation whose call dropped
|--------------------------------------------------------------------------
|
| A clinician who ends a consultation reports an outcome, and a technical failure
| moves the appointment to `abandoned`. A call that drops hard -- the power goes,
| the browser is closed, the handset dies -- is never ended by anybody, and the
| appointment sat `in_progress` for ever.
|
| That is a live state, not an untidy one: it is what the clinic console shows as
| happening now, and an appointment that never reaches a terminal status is one
| the clinic's own reporting cannot count.
|
| The resume window is deliberately generous, because the failure mode in the
| other direction is worse: closing a consultation underneath a clinician who is
| reconnecting after a power cut.
|
| @see docs/20-domain/state-machines.md -- "only after the window closes does the
|      appointment abandon"
|
*/

function staleAppointment(Tenant $tenant, int $endedMinutesAgo, ?AppointmentStatus $status = null): Appointment
{
    return app(Tenancy::class)->run($tenant->id, function () use ($endedMinutesAgo, $status) {
        $end = Date::now()->subMinutes($endedMinutesAgo);

        return Appointment::factory()->create([
            'status' => $status ?? AppointmentStatus::InProgress,
            'scheduled_start_at' => $end->copy()->subMinutes(30),
            'scheduled_end_at' => $end,
        ]);
    });
}

it('abandons a consultation left in progress past the resume window', function () {
    $tenant = Tenant::factory()->create();
    $stale = staleAppointment($tenant, Appointment::RESUME_WINDOW_MINUTES + 10);

    $this->artisan('consultations:abandon-stale')->assertSuccessful();

    $status = app(Tenancy::class)->run($tenant->id, fn () => $stale->fresh()?->status);

    expect($status)->toBe(AppointmentStatus::Abandoned);
});

it('leaves a consultation still inside the resume window alone', function () {
    // A clinician reconnecting after a power cut must rejoin the same consultation,
    // not find it closed.
    $tenant = Tenant::factory()->create();
    $recent = staleAppointment($tenant, Appointment::RESUME_WINDOW_MINUTES - 10);

    $this->artisan('consultations:abandon-stale')->assertSuccessful();

    $status = app(Tenancy::class)->run($tenant->id, fn () => $recent->fresh()?->status);

    expect($status)->toBe(AppointmentStatus::InProgress);
});

it('never touches a consultation that already reached a terminal state', function () {
    // Completed is the ordinary outcome, and rewriting it to abandoned would
    // falsify a record of care that actually happened.
    $tenant = Tenant::factory()->create();

    $completed = staleAppointment($tenant, 5000, AppointmentStatus::Completed);
    $noShow = staleAppointment($tenant, 5000, AppointmentStatus::NoShow);

    $this->artisan('consultations:abandon-stale')->assertSuccessful();

    [$c, $n] = app(Tenancy::class)->run($tenant->id, fn () => [
        $completed->fresh()?->status,
        $noShow->fresh()?->status,
    ]);

    expect($c)->toBe(AppointmentStatus::Completed)
        ->and($n)->toBe(AppointmentStatus::NoShow);
});

it('records that a sweep closed it rather than a clinician', function () {
    // A clinic asked about a consultation it believes happened needs to be able to
    // tell "the clinician reported a technical failure" from "nobody ever ended it".
    $tenant = Tenant::factory()->create();
    staleAppointment($tenant, Appointment::RESUME_WINDOW_MINUTES + 10);

    $this->artisan('consultations:abandon-stale')->assertSuccessful();

    $events = app(Tenancy::class)->run(
        $tenant->id,
        fn () => AuditEvent::query()->where('action', 'appointment.abandoned')->get()
    );

    expect($events)->toHaveCount(1)
        ->and(json_encode($events->first()?->metadata))->toContain('resume_window_elapsed');
});

it('does not reach across clinics', function () {
    $clinicA = Tenant::factory()->create();
    $clinicB = Tenant::factory()->create();

    $atA = staleAppointment($clinicA, Appointment::RESUME_WINDOW_MINUTES + 10);
    $atB = staleAppointment($clinicB, Appointment::RESUME_WINDOW_MINUTES + 10);

    $this->artisan('consultations:abandon-stale', ['--tenant' => $clinicA->id])->assertSuccessful();

    $a = app(Tenancy::class)->run($clinicA->id, fn () => $atA->fresh()?->status);
    $b = app(Tenancy::class)->run($clinicB->id, fn () => $atB->fresh()?->status);

    expect($a)->toBe(AppointmentStatus::Abandoned)
        ->and($b)->toBe(AppointmentStatus::InProgress);
});

it('skips a closed clinic entirely', function () {
    $closed = Tenant::factory()->create(['status' => TenantStatus::Closed]);
    $stale = staleAppointment($closed, Appointment::RESUME_WINDOW_MINUTES + 10);

    $this->artisan('consultations:abandon-stale')->assertSuccessful();

    $status = app(Tenancy::class)->run($closed->id, fn () => $stale->fresh()?->status);

    expect($status)->toBe(AppointmentStatus::InProgress);
});
