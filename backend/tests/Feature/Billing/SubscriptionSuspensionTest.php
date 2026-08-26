<?php

use App\Models\Appointment;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\Patient;
use App\Models\SubscriptionPlan;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Support\Money;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Suspension for non-payment — a commercial act that must never become clinical
|--------------------------------------------------------------------------
|
| A scheduled job that can stop a clinic working is the highest-consequence
| automatic act in this system, and the rule it has to keep is older than
| billing: suspension blocks STAFF SIGN-IN, and it does NOT block a patient
| reading their own records, a delivery already in flight, or the offboarding
| export.
|
| That rule is stated in three places — TenantStatus, Accounts::mayStartSession()
| and TenantPolicy::export() — and none of them changed for billing. THIS FILE
| VERIFIES THAT RATHER THAN ASSUMING IT. The whole risk of adding an automatic
| suspender is that the rule was true when a human did the suspending and is
| quietly not true when a cron does, so every clause is re-asserted here against
| a clinic suspended BY THE SWEEP.
|
| Two refusals matter as much as the suspension itself:
|
|   - A clinic with no commercial record at all is NOT suspended. Every clinic in
|     the register had a null current_period_ends_at the day this shipped,
|     because the column did not exist the day before. Reading "no paid period"
|     as "lapsed" would have suspended every clinic in the country on the first
|     run, from a scheduled job, at whatever hour the deployment landed.
|
|   - A clinic inside the grace window is not suspended. Mobile-money collections
|     here fail for reasons unconnected to willingness to pay, and closing a
|     clinic's front desk over a telecom fault would be a clinical harm caused by
|     a billing rule.
|
| See docs/20-domain/state-machines.md — tenant lifecycle
| See docs/50-security-compliance/rbac-matrix.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    // Seven days, stated rather than inherited, so a change to the default does
    // not silently move what these tests mean.
    config(['billing.grace_days' => 7]);
});

afterEach(function () {
    Date::setTestNow();
});

function lapseUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic on a plan, paid through some moment.
 *
 * `$paidThrough` null means "no commercial record at all" — the deploy-day
 * state, and the one the sweep must leave alone.
 */
function lapsedClinic(?string $paidThrough, TenantStatus $status = TenantStatus::Active): Tenant
{
    $tenant = Tenant::factory()->create(['status' => $status]);

    $tenant->plan = SubscriptionPlan::Clinic;
    $tenant->plan_price = Money::ugx(250_000);

    if ($paidThrough !== null) {
        $tenant->current_period_ends_at = Carbon::parse($paidThrough);
    }

    $tenant->save();

    return $tenant;
}

function lapseStaff(Tenant $tenant, ClinicalRole $role, string $phone): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role, $phone): User {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => $phone,
            'password' => 'the-right-password',
        ]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A patient of this clinic, with their own account linked to their record.
 *
 * @return array{User, Patient}
 */
function lapsePatient(Tenant $tenant, string $phone): array
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $phone): array {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => $phone,
            'password' => 'the-right-password',
        ]);
        $user->assignRole(ClinicalRole::Patient->value);

        $patient = Patient::factory()->create(['phone' => $phone]);
        $patient->user_id = $user->id;
        $patient->save();

        return [$user, $patient];
    });
}

/** @param  array<string, mixed>  $options */
function runSweep(array $options = []): int
{
    return Artisan::call('billing:suspend-lapsed', $options);
}

// --- What the sweep does, and to whom ------------------------------------

it('suspends a clinic whose paid period ended beyond the grace window', function () {
    Date::setTestNow('2026-09-01 06:00:00');

    // Paid through 1 August. Grace is seven days, so it lapsed on the 8th.
    $tenant = lapsedClinic('2026-08-01 23:59:59');

    runSweep();

    expect($tenant->refresh()->status)->toBe(TenantStatus::Suspended);

    // Audited as the same action a manual suspension writes, with the reason
    // attached. A support agent reading the trail should not need to know which
    // of two words to search for.
    $event = AuditEvent::query()
        ->whereNull('tenant_id')
        ->where('action', 'tenant.status_changed')
        ->latest('id')
        ->firstOrFail();

    expect($event->metadata['to'] ?? null)->toBe('suspended')
        ->and($event->metadata['reason'] ?? null)->toBe('subscription_lapsed')
        ->and($event->actor_type)->toBe('system');
});

it('leaves a clinic alone while it is inside the grace window', function () {
    Date::setTestNow('2026-09-01 06:00:00');

    // Paid through 27 August. Seven days' grace runs to 3 September.
    $tenant = lapsedClinic('2026-08-27 23:59:59');

    runSweep();

    expect($tenant->refresh()->status)->toBe(TenantStatus::Active);
});

it('leaves a clinic with no commercial record at all alone', function () {
    // THE DEPLOY-DAY TEST. Every clinic in the register looked exactly like this
    // the moment the column was added. Absence of a commercial record is not
    // evidence of non-payment, and the answer to it is a conversation.
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = lapsedClinic(null);

    runSweep();

    expect($tenant->refresh()->status)->toBe(TenantStatus::Active);
});

it('falls back to the trial end date when no period has been paid for', function () {
    // A trial that expires without converting lapses in the ordinary way, rather
    // than granting indefinite free service.
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = Tenant::factory()->create(['trial_ends_at' => Carbon::parse('2026-08-01 00:00:00')]);

    runSweep();

    expect($tenant->refresh()->status)->toBe(TenantStatus::Suspended);
});

it('touches no clinic that is not active, whatever its dates say', function () {
    // TenantStatus permits active -> suspended and nothing else into that state,
    // so a provisioning clinic, one already suspended and one part-way through
    // offboarding all need no special case here. The state machine already said
    // so; this asserts the sweep did not go around it.
    Date::setTestNow('2026-09-01 06:00:00');

    $provisioning = lapsedClinic('2026-01-01 00:00:00', TenantStatus::Provisioning);
    $offboarding = lapsedClinic('2026-01-01 00:00:00', TenantStatus::Offboarding);

    runSweep();

    expect($provisioning->refresh()->status)->toBe(TenantStatus::Provisioning)
        ->and($offboarding->refresh()->status)->toBe(TenantStatus::Offboarding);
});

it('changes nothing on a dry run', function () {
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = lapsedClinic('2026-08-01 23:59:59');

    runSweep(['--dry-run' => true]);

    expect($tenant->refresh()->status)->toBe(TenantStatus::Active);
});

it('refuses to run with a tenant bound', function () {
    // Bound, every query below would read one clinic's view of a platform-scoped
    // table. Refusing is cheaper than reasoning about which.
    $tenant = lapsedClinic('2026-01-01 00:00:00');

    $exit = app(Tenancy::class)->run($tenant->id, fn (): int => runSweep());

    expect($exit)->toBe(1)
        ->and($tenant->refresh()->status)->toBe(TenantStatus::Active);
});

// --- The rule that must survive the sweep --------------------------------

it('blocks staff sign-in at a clinic the sweep suspended', function () {
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = lapsedClinic('2026-08-01 23:59:59');
    $clinician = lapseStaff($tenant, ClinicalRole::Clinician, '+256772000301');

    runSweep();

    $this->postJson(lapseUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $clinician->phone,
        'password' => 'the-right-password',
    ])
        ->assertForbidden()
        // The code, not just the status. A status line alone cannot tell a
        // suspended clinic from a policy denial or a throttle.
        ->assertJsonPath('code', 'tenant_suspended');

    $this->assertGuest();
});

it('does not block a patient reading their own records at a clinic the sweep suspended', function () {
    // THE CLAUSE WITH THE SHARPEST CONSEQUENCE. A commercial dispute between
    // Carevelo and a clinic must not stand between a patient and their own
    // medical record.
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = lapsedClinic('2026-08-01 23:59:59');
    [$patientUser, $patient] = lapsePatient($tenant, '+256772000401');

    runSweep();

    expect($tenant->refresh()->status)->toBe(TenantStatus::Suspended);

    // They can still open a session...
    $this->postJson(lapseUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => '+256772000401',
        'password' => 'the-right-password',
    ])->assertOk();

    // ...and still read their own records through it. An APPOINTMENT rather
    // than the bare patient row, because that is the surface the catalogue marks
    // `P own`: the thing a patient actually needs during a dispute is to see
    // when they are expected and what they were prescribed.
    $appointment = app(Tenancy::class)->run(
        $tenant->id,
        fn (): Appointment => Appointment::factory()->create(['patient_id' => $patient->id]),
    );

    $this->actingAs($patientUser)
        ->getJson(lapseUrl($tenant, '/api/v1/appointments/'.$appointment->id))
        ->assertOk()
        ->assertJsonPath('data.id', $appointment->id);

    // And their own identity, which is what tells a client which record is
    // theirs at all.
    $this->actingAs($patientUser)
        ->getJson(lapseUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('data.patient_ids', [$patient->id]);
});

it('does not block a delivery already in flight at a clinic the sweep suspended', function () {
    // A rider carrying medicines when the sweep runs must still be able to
    // complete the round and record it. Medicine does not sit with a rider
    // overnight because of an unpaid invoice.
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = lapsedClinic('2026-08-01 23:59:59');
    $rider = lapseStaff($tenant, ClinicalRole::Rider, '+256772000501');

    $delivery = app(Tenancy::class)->run($tenant->id, function () use ($rider): Delivery {
        $delivery = Delivery::factory()->create();
        $delivery->rider_id = $rider->id;
        $delivery->status = DeliveryStatus::EnRoute;
        $delivery->save();

        return $delivery;
    });

    runSweep();

    expect($tenant->refresh()->status)->toBe(TenantStatus::Suspended);

    $this->actingAs($rider)
        ->postJson(lapseUrl($tenant, '/api/v1/rider/deliveries/'.$delivery->id.'/status'), [
            'status' => 'delivered',
        ])
        ->assertOk();

    $completed = app(Tenancy::class)->run(
        $tenant->id,
        fn (): Delivery => Delivery::query()->findOrFail($delivery->id),
    );

    expect($completed->status)->toBe(DeliveryStatus::Delivered);
});

it('does not let suspension withhold the offboarding export', function () {
    // The clinic is the data controller and leaves with its data REGARDLESS of
    // any commercial dispute. Withholding it to secure payment would be unlawful
    // and would harm patients, and a clinic in dispute is precisely the one
    // somebody would be tempted to withhold it from.
    Date::setTestNow('2026-09-01 06:00:00');

    $tenant = lapsedClinic('2026-08-01 23:59:59');

    runSweep();

    $operator = User::factory()->create(['tenant_id' => null]);
    $operator->assignRole(ClinicalRole::PlatformAdmin->value);

    $this->withHeader('Referer', sprintf('http://%s/', parse_url((string) config('app.url'), PHP_URL_HOST)))
        ->actingAsOperator($operator)
        ->postJson(sprintf(
            'http://%s/api/v1/platform/tenants/%s/export',
            parse_url((string) config('app.url'), PHP_URL_HOST),
            $tenant->id,
        ))
        ->assertOk();
});
