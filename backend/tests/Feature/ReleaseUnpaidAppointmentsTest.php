<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Models\WorkingHour;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Releasing the slot an abandoned payment is holding
|--------------------------------------------------------------------------
|
| Booking holds the slot while the mobile-money prompt sits on the patient's
| handset, and availability excludes it deliberately -- offering it twice would
| send a second patient into a rejection at the last step.
|
| Most prompts are never completed. Until this command existed nothing released
| those slots: `awaiting_payment --> expired` was specified in the state machine
| and implemented nowhere, so every abandoned prompt removed a slot from the
| clinic's calendar permanently. The clinic would experience that as "the system
| says we are full".
|
| The last test here is the one that matters commercially -- it asserts the slot
| comes BACK, through the availability endpoint, rather than merely that a status
| column changed.
|
| @see docs/20-domain/state-machines.md
|
*/

function unpaidTenant(TenantStatus $status = TenantStatus::Active): Tenant
{
    return Tenant::factory()->create(['status' => $status]);
}

function unpaidBooking(Tenant $tenant, int $minutesAgo, ?AppointmentStatus $status = null): Appointment
{
    return app(Tenancy::class)->run($tenant->id, function () use ($minutesAgo, $status) {
        $appointment = Appointment::factory()->create([
            'status' => $status ?? AppointmentStatus::AwaitingPayment,
        ]);

        // created_at is not fillable and the factory sets it to now.
        $appointment->forceFill(['created_at' => Date::now()->subMinutes($minutesAgo)])->save();

        return $appointment->fresh() ?? $appointment;
    });
}

it('releases a booking left unpaid past the hold window', function () {
    $tenant = unpaidTenant();
    $stale = unpaidBooking($tenant, Appointment::UNPAID_HOLD_MINUTES + 1);

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    $status = app(Tenancy::class)->run($tenant->id, fn () => $stale->fresh()?->status);

    expect($status)->toBe(AppointmentStatus::Expired);
});

it('leaves a booking still inside the hold window alone', function () {
    // The patient may well be mid-prompt. Releasing here would take the slot out
    // from under someone actively paying for it.
    $tenant = unpaidTenant();
    $fresh = unpaidBooking($tenant, Appointment::UNPAID_HOLD_MINUTES - 5);

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    $status = app(Tenancy::class)->run($tenant->id, fn () => $fresh->fresh()?->status);

    expect($status)->toBe(AppointmentStatus::AwaitingPayment);
});

it('never touches an appointment that is not awaiting payment', function () {
    $tenant = unpaidTenant();

    $confirmed = unpaidBooking($tenant, 600, AppointmentStatus::Confirmed);
    $cancelled = unpaidBooking($tenant, 600, AppointmentStatus::Cancelled);

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    [$c, $x] = app(Tenancy::class)->run($tenant->id, fn () => [
        $confirmed->fresh()?->status,
        $cancelled->fresh()?->status,
    ]);

    expect($c)->toBe(AppointmentStatus::Confirmed)
        ->and($x)->toBe(AppointmentStatus::Cancelled);
});

it('records why the slot was taken back', function () {
    // Expiry removes something from a patient who was mid-payment, and `expired`
    // and `cancelled` are deliberately different states the clinic reads
    // differently.
    $tenant = unpaidTenant();
    unpaidBooking($tenant, Appointment::UNPAID_HOLD_MINUTES + 1);

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    $events = app(Tenancy::class)->run(
        $tenant->id,
        fn () => AuditEvent::query()->where('action', 'appointment.slot_released')->get()
    );

    expect($events)->toHaveCount(1)
        ->and(json_encode($events->first()?->metadata))->toContain('unpaid_hold_elapsed');
});

it('leaves the payment intent alone, because a late confirmation is ordinary', function () {
    // timed_out is explicitly NOT final. Cancelling the collection here would
    // discard a payment that mobile money may still confirm, and the money goes to
    // the clinic's own account either way -- Carevelo holds none of it and does not
    // decide refund policy.
    $tenant = unpaidTenant();
    $stale = unpaidBooking($tenant, Appointment::UNPAID_HOLD_MINUTES + 1);

    $intent = app(Tenancy::class)->run($tenant->id, fn () => PaymentIntent::factory()->create([
        'payable_type' => 'appointment',
        'payable_id' => $stale->id,
        'status' => PaymentIntentStatus::Pending,
    ]));

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    $after = app(Tenancy::class)->run($tenant->id, fn () => $intent->fresh()?->status);

    expect($after)->toBe(PaymentIntentStatus::Pending);
});

it('does not reach across clinics', function () {
    $clinicA = unpaidTenant();
    $clinicB = unpaidTenant();

    $atA = unpaidBooking($clinicA, Appointment::UNPAID_HOLD_MINUTES + 1);
    $atB = unpaidBooking($clinicB, Appointment::UNPAID_HOLD_MINUTES + 1);

    // Sweeping ONE clinic must leave the other's calendar untouched.
    $this->artisan('appointments:release-unpaid', ['--tenant' => $clinicA->id])->assertSuccessful();

    $a = app(Tenancy::class)->run($clinicA->id, fn () => $atA->fresh()?->status);
    $b = app(Tenancy::class)->run($clinicB->id, fn () => $atB->fresh()?->status);

    expect($a)->toBe(AppointmentStatus::Expired)
        ->and($b)->toBe(AppointmentStatus::AwaitingPayment);
});

it('skips a closed clinic entirely', function () {
    $closed = unpaidTenant(TenantStatus::Closed);
    $booking = unpaidBooking($closed, Appointment::UNPAID_HOLD_MINUTES + 1);

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    $status = app(Tenancy::class)->run($closed->id, fn () => $booking->fresh()?->status);

    expect($status)->toBe(AppointmentStatus::AwaitingPayment);
});

it('gives the slot back to availability', function () {
    // THE test. Everything above asserts a status column; this asserts the
    // behaviour the clinic actually loses -- a slot nobody can book.
    $tenant = Tenant::factory()->create(['timezone' => 'Africa/Kampala']);

    $this->seed(RoleSeeder::class);

    [$clinician, $service, $taken, $caller] = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $caller = User::factory()->create(['tenant_id' => $tenant->id]);
        $caller->assignRole(ClinicalRole::Patient->value);

        foreach (range(0, 6) as $day) {
            WorkingHour::factory()->forDay($day)->opening('08:00:00', '17:00:00')->create();
        }

        $clinician = Clinician::factory()->create();
        $service = Service::factory()->create(['duration_minutes' => 30]);

        $slot = Date::now('Africa/Kampala')->addDay()->setTime(9, 0);

        $appointment = Appointment::factory()->create([
            'clinician_id' => $clinician->id,
            'service_id' => $service->id,
            'scheduled_start_at' => $slot,
            'scheduled_end_at' => $slot->copy()->addMinutes(30),
            'status' => AppointmentStatus::AwaitingPayment,
        ]);

        $appointment->forceFill([
            'created_at' => Date::now()->subMinutes(Appointment::UNPAID_HOLD_MINUTES + 1),
        ])->save();

        return [$clinician, $service, $slot, $caller];
    });

    $url = sprintf(
        'http://%s.%s/api/v1/availability?service_id=%s&clinician_id=%s&from=%s&to=%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $service->id,
        $clinician->id,
        $taken->toDateString(),
        $taken->toDateString(),
    );

    $before = collect((array) $this->actingAs($caller)->getJson($url)->assertOk()->json('data'))
        ->pluck('starts_at');

    expect($before)->not->toContain($taken->toIso8601String());

    $this->artisan('appointments:release-unpaid')->assertSuccessful();

    $after = collect((array) $this->actingAs($caller)->getJson($url)->assertOk()->json('data'))
        ->pluck('starts_at');

    expect($after)->toContain($taken->toIso8601String());
});
