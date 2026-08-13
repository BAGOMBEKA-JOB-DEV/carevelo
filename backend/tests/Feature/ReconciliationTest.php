<?php

use App\Audit\AuditLog;
use App\Jobs\ReconcilePaymentIntentJob;
use App\Models\AggregatorAccount;
use App\Models\Appointment;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Payments\FakeGateway;
use App\Services\Payments\FlutterwaveGateway;
use App\Services\Payments\GatewayStatus;
use App\Services\Payments\PaymentGateway;
use App\Tenancy\Tenancy;
use Carbon\CarbonImmutable;
use Database\Factories\AggregatorAccountFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| Reconciliation -- the backstop
|--------------------------------------------------------------------------
|
| A webhook is NEVER the only path to resolution. Missed and delayed webhooks
| are ordinary in this market, and an intent stuck in pending forever is a
| patient who does not know whether they paid.
|
| The rule with the sharpest consequence: timed_out is NOT final.
|
| See docs/40-api/webhooks.md and docs/10-product/prd-h5-payments-non-custodial.md
|
*/

/**
 * A clinic, its own aggregator account, and one payment attempt.
 *
 * $age is a PostgreSQL interval, applied BY THE DATABASE CLOCK. The production
 * code measures a payment's age the same way -- a queue worker's clock and the
 * database's need not agree -- so ageing fixtures in PHP would exercise an
 * arithmetic the system does not perform.
 *
 * @param  array<string, mixed>  $intentAttributes
 * @return array{Tenant, AggregatorAccount, PaymentIntent}
 */
function reconFixture(array $intentAttributes = [], ?string $age = null): array
{
    $tenant = Tenant::factory()->create();

    [$account, $intent] = app(Tenancy::class)->run($tenant->id, function () use ($intentAttributes, $age): array {
        $account = AggregatorAccountFactory::new()->createOne();
        $intent = PaymentIntent::factory()->create($intentAttributes);

        if ($age !== null) {
            // The interval is a bound parameter, not interpolated SQL: a test
            // helper is still code, and this one writes to a payments table.
            DB::update(
                'update payment_intents set initiated_at = now() - ?::interval where id = ?',
                [$age, $intent->id],
            );

            $intent->refresh();
        }

        return [$account, $intent];
    });

    return [$tenant, $account, $intent];
}

function reconGateway(): FakeGateway
{
    $gateway = new FakeGateway;

    app()->instance(PaymentGateway::class, $gateway);

    return $gateway;
}

function reconUrl(Tenant $tenant, string $query = ''): string
{
    return sprintf(
        'http://%s.%s/api/v1/reconciliation%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $query,
    );
}

function reconStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role): User {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

it('resolves the real aggregator client by default, never the fake', function () {
    // The fake is bound only by a test that asks for it. If it were ever the
    // container's default, every payment in production would sit unresolved
    // forever while looking perfectly healthy.
    expect(app(PaymentGateway::class))->toBeInstanceOf(FlutterwaveGateway::class);
});

it('moves a timed-out intent to succeeded on a late confirmation', function () {
    // THE critical payment rule, on the path that actually exercises it. A
    // mobile-money confirmation that arrives after the window still has to
    // resolve the intent -- treating a timeout as definitive failure produces
    // the worst outcome available: a patient charged for a cancelled booking.
    [$tenant, , $intent] = reconFixture([
        'status' => PaymentIntentStatus::TimedOut,
    ], age: '2 hours');

    $gateway = reconGateway();

    app(Tenancy::class)->run($tenant->id, function () use ($intent, $gateway) {
        $gateway->will($intent, GatewayStatus::succeeded(3_000_000, 'FLW-LATE-0001'));

        (new ReconcilePaymentIntentJob($intent->id))->handle();

        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($fresh?->aggregator_reference)->toBe('FLW-LATE-0001')
            ->and($fresh?->next_poll_at)->toBeNull();
    });
});

it('does nothing when the webhook already resolved the intent', function () {
    // The two paths race by design. The loser is a no-op, and must not even
    // ask -- a resolved intent is settled fact.
    [$tenant, , $intent] = reconFixture([
        'status' => PaymentIntentStatus::Succeeded,
        'resolved_at' => Date::now(),
    ]);

    $gateway = reconGateway()->willAlways(GatewayStatus::failed('LATE', 'Too late'));

    app(Tenancy::class)->run($tenant->id, function () use ($intent, $gateway) {
        (new ReconcilePaymentIntentJob($intent->id))->handle();

        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($gateway->intentsPolled)->toBe([]);
    });
});

it('never accepts a polled amount that differs from the stored intent', function () {
    // The fraud boundary applies to the poll exactly as it applies to the
    // callback. One code path, one rule, no drift between them.
    [$tenant, , $intent] = reconFixture([
        'status' => PaymentIntentStatus::TimedOut,
        'amount_minor' => 3_000_000,
    ], age: '2 hours');

    $gateway = reconGateway();

    app(Tenancy::class)->run($tenant->id, function () use ($intent, $gateway) {
        $gateway->will($intent, GatewayStatus::succeeded(100, 'FLW-WRONG'));

        (new ReconcilePaymentIntentJob($intent->id))->handle();

        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::TimedOut)
            ->and($intent->fresh()?->aggregator_reference)->toBeNull()
            ->and(AuditEvent::query()->where('action', 'payment.amount_mismatch_flagged')->count())->toBe(1);
    });
});

it('uses the tenant\'s own aggregator credentials', function () {
    // There is no platform merchant account. Every call resolves credentials
    // from the calling tenant's own AggregatorAccount, and row-level security
    // means no other one is reachable.
    [$tenant, $account, $intent] = reconFixture(age: '5 minutes');

    $gateway = reconGateway();

    app(Tenancy::class)->run($tenant->id, function () use ($intent, $gateway, $account) {
        (new ReconcilePaymentIntentJob($intent->id))->handle();

        expect($gateway->accountsUsed)->toBe([$account->id]);
    });
});

it('times out a pending intent once the window elapses', function () {
    [$tenant, , $intent] = reconFixture([
        'status' => PaymentIntentStatus::Pending,
    ], age: '2 hours');

    reconGateway()->willAlways(GatewayStatus::pending());

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        (new ReconcilePaymentIntentJob($intent->id))->handle();

        $fresh = $intent->fresh();

        // Timed out, and STILL SCHEDULED. The poll continues, because this is
        // not an ending.
        expect($fresh?->status)->toBe(PaymentIntentStatus::TimedOut)
            ->and($fresh?->next_poll_at)->not->toBeNull();
    });
});

it('keeps waiting inside the window rather than timing out early', function () {
    [$tenant, , $intent] = reconFixture([
        'status' => PaymentIntentStatus::Pending,
    ], age: '5 minutes');

    reconGateway()->willAlways(GatewayStatus::pending());

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        (new ReconcilePaymentIntentJob($intent->id))->handle();

        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending)
            ->and($intent->fresh()?->poll_attempts)->toBe(1);
    });
});

it('stops polling and flags for the administrator after twenty-four hours', function () {
    [$tenant, , $intent] = reconFixture([
        'status' => PaymentIntentStatus::TimedOut,
    ], age: '25 hours');

    $gateway = reconGateway();

    app(Tenancy::class)->run($tenant->id, function () use ($intent, $gateway) {
        (new ReconcilePaymentIntentJob($intent->id))->handle();

        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Failed)
            ->and($fresh?->next_poll_at)->toBeNull()
            ->and($gateway->intentsPolled)->toBe([])
            ->and(AuditEvent::query()->where('action', 'payment.reconciliation_abandoned')->count())->toBe(1);
    });
});

it('backs off instead of spinning the queue when the aggregator is unreachable', function () {
    [$tenant, , $intent] = reconFixture(age: '5 minutes');

    reconGateway()->willFail();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        (new ReconcilePaymentIntentJob($intent->id))->handle();

        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending)
            ->and($intent->fresh()?->next_poll_at)->not->toBeNull();
    });
});

it('sweeps only the intents whose poll is due', function () {
    Queue::fake();

    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        PaymentIntent::factory()->create(['next_poll_at' => Date::now()->subMinute()]);
        PaymentIntent::factory()->create(['next_poll_at' => Date::now()->addMinutes(5)]);
        PaymentIntent::factory()->create(['next_poll_at' => null]);
        // Resolved: nothing left to ask about, whatever the schedule says.
        PaymentIntent::factory()->succeeded()->create(['next_poll_at' => Date::now()->subMinute()]);
    });

    $this->artisan('payments:reconcile', ['--tenant' => $tenant->id])->assertSuccessful();

    Queue::assertPushed(ReconcilePaymentIntentJob::class, 1);
});

it('flags mismatching records in the daily view', function () {
    // We reconcile RECORDS, not money: we cannot see what the clinic received.
    // What we can do is point at the references worth checking.
    $this->seed(RoleSeeder::class);

    // A day comfortably in the past, in the CLINIC's timezone -- an
    // administrator reconciling a past day means the day they worked, and
    // everything on it is old enough to have outlived every window.
    $day = CarbonImmutable::now('Africa/Kampala')->subDays(2)->startOfDay();
    $noon = $day->setTime(12, 0);

    $tenant = Tenant::factory()->create();

    $ids = app(Tenancy::class)->run($tenant->id, function () use ($noon): array {
        $stuck = PaymentIntent::factory()->create([
            'status' => PaymentIntentStatus::Pending,
            'initiated_at' => $noon,
        ]);

        $stale = PaymentIntent::factory()->create([
            'status' => PaymentIntentStatus::TimedOut,
            'initiated_at' => $noon->addMinute(),
        ]);

        $reversed = PaymentIntent::factory()->create([
            'status' => PaymentIntentStatus::Reversed,
            'initiated_at' => $noon->addMinutes(2),
        ]);

        $unmoved = PaymentIntent::factory()->succeeded()->create([
            'payable_type' => 'appointment',
            'payable_id' => Appointment::factory()->awaitingPayment()->create()->id,
            'initiated_at' => $noon->addMinutes(3),
        ]);

        $healthy = PaymentIntent::factory()->succeeded()->create([
            'payable_type' => 'appointment',
            'payable_id' => Appointment::factory()->create()->id,
            'initiated_at' => $noon->addMinutes(4),
        ]);

        app(AuditLog::class)->record(
            'payment.amount_mismatch_flagged',
            'PaymentIntent',
            $stuck->id,
            ['source' => 'webhook'],
        );

        return [
            'stuck' => $stuck->id,
            'stale' => $stale->id,
            'reversed' => $reversed->id,
            'unmoved' => $unmoved->id,
            'healthy' => $healthy->id,
        ];
    });

    $response = $this->actingAs(reconStaff($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(reconUrl($tenant, '?date='.$day->toDateString()))
        ->assertOk();

    /** @var array<int, array{id: string, flags: list<string>}> $rows */
    $rows = $response->json('data.intents');
    $flags = collect($rows)->keyBy('id')->map(fn (array $row): array => $row['flags']);

    expect($flags[$ids['stuck']])->toContain('stuck_pending')
        ->and($flags[$ids['stuck']])->toContain('amount_mismatch')
        ->and($flags[$ids['stale']])->toContain('timed_out_beyond_window')
        ->and($flags[$ids['reversed']])->toContain('reversed')
        ->and($flags[$ids['unmoved']])->toContain('succeeded_without_progression')
        ->and($flags[$ids['healthy']])->toBe([])
        ->and($response->json('meta.flagged'))->toBe(4);
});

it('refuses the reconciliation view to anyone but the administrator', function () {
    // Denial tested, not just permission. Reconciliation is a commercial view
    // of the whole clinic's takings; a pharmacist has no business in it.
    $this->seed(RoleSeeder::class);

    $tenant = Tenant::factory()->create();

    $this->actingAs(reconStaff($tenant, ClinicalRole::Pharmacist))
        ->getJson(reconUrl($tenant))
        ->assertForbidden();
});

it('makes no claim about money it cannot see', function () {
    // No total collected, no reconciled figure, no variance -- each would be an
    // assertion about funds that never passed through Carevelo.
    $this->seed(RoleSeeder::class);

    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, fn () => PaymentIntent::factory()->succeeded()->create());

    $body = strtolower((string) json_encode(
        $this->actingAs(reconStaff($tenant, ClinicalRole::ClinicAdmin))
            ->getJson(reconUrl($tenant))
            ->assertOk()
            ->json()
    ));

    foreach (['wallet', 'balance', 'escrow', 'payout', 'settlement'] as $forbidden) {
        expect($body)->not->toContain($forbidden, "Reconciliation view leaked '{$forbidden}'");
    }
});
