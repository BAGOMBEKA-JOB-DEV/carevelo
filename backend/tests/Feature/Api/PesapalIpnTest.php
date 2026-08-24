<?php

use App\Models\AggregatorAccount;
use App\Models\AuditEvent;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Services\Payments\GatewayStatus;
use App\Services\Payments\PaymentGateway;
use App\Services\Payments\Pesapal\FakePesapal;
use App\Services\Payments\ResolutionOutcome;
use App\Tenancy\Tenancy;
use Database\Factories\AggregatorAccountFactory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Pesapal's instant payment notification — a hint, never a source of truth
|--------------------------------------------------------------------------
|
| The notification carries OrderTrackingId, OrderMerchantReference and
| OrderNotificationType. NO STATUS. NO AMOUNT. NO SIGNATURE, and no shared
| secret with which one could be computed. Pesapal does this deliberately: you
| are required to call GetTransactionStatus yourself.
|
| That is the single most important fact about this endpoint, and the easiest
| thing in this change for a future reader to "fix" into a vulnerability by
| reading a status out of the body to save a round trip. These tests exist to
| make that change fail loudly.
|
| The endpoint is safe because a forged notification can achieve exactly one
| thing: cause an authenticated re-read of a status Pesapal owns, with the
| clinic's own credentials — a question we were going to ask anyway on the
| reconciliation schedule. Every test below is a way of saying that.
|
| See docs/70-decisions/0012-pesapal-unsigned-ipn.md
|
*/

/**
 * A clinic with a Pesapal account, and one attempt Pesapal knows about.
 *
 * @param  array<string, mixed>  $intentAttributes
 * @return array{Tenant, AggregatorAccount, PaymentIntent}
 */
function ipnFixture(array $intentAttributes = [], bool $configured = true): array
{
    $tenant = Tenant::factory()->create();

    [$account, $intent] = app(Tenancy::class)->run($tenant->id, function () use ($intentAttributes, $configured): array {
        $factory = AggregatorAccountFactory::new()->pesapal();

        return [
            $configured ? $factory->createOne() : $factory->unconfigured()->createOne(),
            PaymentIntent::factory()->create(array_merge([
                'aggregator' => 'pesapal',
                'aggregator_tracking_id' => IPN_TRACKING_ID,
            ], $intentAttributes)),
        ];
    });

    return [$tenant, $account, $intent];
}

const IPN_TRACKING_ID = 'b945e4af-80a5-4ec1-8706-e03f8332fb04';

function ipnUrl(Tenant $tenant): string
{
    return '/api/webhooks/pesapal/'.$tenant->id;
}

/**
 * The body Pesapal actually POSTs.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function ipnBody(string $trackingId = IPN_TRACKING_ID, array $overrides = []): array
{
    return array_merge([
        'OrderTrackingId' => $trackingId,
        'OrderMerchantReference' => 'PAY-2608-0001',
        'OrderNotificationType' => 'IPNCHANGE',
    ], $overrides);
}

function ipnGateway(GatewayStatus $status): FakePesapal
{
    $fake = new FakePesapal;
    $fake->willAlways($status);

    app()->instance(PaymentGateway::class, $fake);

    return $fake;
}

/** @return Collection<int, AuditEvent> */
function ipnAuditEvents(Tenant $tenant, string $action): Collection
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn () => AuditEvent::query()->where('action', $action)->get(),
    );
}

// --- The happy path, and what it proves about where truth comes from ------

it('resolves an attempt from the status it reads back, with the clinic\'s own credentials', function () {
    [$tenant, $account, $intent] = ipnFixture();

    $fake = ipnGateway(GatewayStatus::succeeded(3_000_000, 'PESA-CONF-77'));

    $this->postJson(ipnUrl($tenant), ipnBody())
        ->assertOk()
        ->assertExactJson(['received' => true]);

    // THE CLINIC'S OWN account, and no other. There is no platform merchant
    // account to fall back on because no such account exists.
    expect($fake->accountsUsed)->toBe([$account->id])
        ->and($fake->intentsPolled)->toBe([$intent->id]);

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($fresh?->aggregator_reference)->toBe('PESA-CONF-77')
            ->and($fresh?->resolved_at)->not->toBeNull();
    });
});

it('accepts the notification as a GET as well, and trusts it no further', function () {
    // Pesapal registers a notification type per URL and has sent both. Neither
    // is trusted, because neither carries anything that could be trusted.
    [$tenant, , $intent] = ipnFixture();

    ipnGateway(GatewayStatus::succeeded(3_000_000, 'PESA-CONF-77'));

    $this->getJson(ipnUrl($tenant).'?OrderTrackingId='.IPN_TRACKING_ID)->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Succeeded);
    });
});

// --- Rule 3: unknown tracking id is a neutral 404 -------------------------

it('answers a neutral 404 to an unknown tracking id, an unknown tenant and an unconfigured clinic alike', function () {
    // Three different failures, one indistinguishable answer. The endpoint is
    // public: confirming which clinics use Carevelo, or which tracking ids
    // exist, is itself a disclosure — and a caller able to tell the three apart
    // could enumerate either.
    [$tenant] = ipnFixture();
    [$unconfigured] = ipnFixture(configured: false);

    ipnGateway(GatewayStatus::succeeded(3_000_000));

    $unknownTrackingId = $this->postJson(ipnUrl($tenant), ipnBody('11111111-2222-3333-4444-555555555555'));
    $unknownTenant = $this->postJson('/api/webhooks/pesapal/'.Str::ulid(), ipnBody());
    $notConfigured = $this->postJson(ipnUrl($unconfigured), ipnBody());
    $noTrackingIdAtAll = $this->postJson(ipnUrl($tenant), ['OrderNotificationType' => 'IPNCHANGE']);

    foreach ([$unknownTrackingId, $unknownTenant, $notConfigured, $noTrackingIdAtAll] as $response) {
        $response->assertNotFound();
        expect($response->getContent())->toBe($unknownTrackingId->getContent());
    }
});

it('cannot be used to reach another clinic\'s attempt', function () {
    // The lookup happens inside one tenant's row-level security context, so a
    // tracking id belonging to another clinic is not hidden by a filter someone
    // could remove — it is simply not there to be found.
    [$victim, , $victimIntent] = ipnFixture();
    [$attacker] = ipnFixture(['aggregator_tracking_id' => 'a-different-tracking-id']);

    ipnGateway(GatewayStatus::succeeded(3_000_000, 'PESA-CONF-77'));

    $this->postJson(ipnUrl($attacker), ipnBody(IPN_TRACKING_ID))->assertNotFound();

    app(Tenancy::class)->run($victim->id, function () use ($victimIntent) {
        expect($victimIntent->fresh()?->status)->toBe(PaymentIntentStatus::Pending);
    });
});

// --- Rule 4: a forged notification changes nothing ------------------------

it('changes nothing on a forged notification, because the status is re-read from Pesapal', function () {
    // The heart of ADR-0012. This body is everything an attacker would want to
    // say — a completed status, a large amount, someone else's reference — and
    // NONE OF IT IS READ. The endpoint takes OrderTrackingId and nothing else,
    // and then asks Pesapal, which says the patient has not paid yet.
    [$tenant, , $intent] = ipnFixture();

    $fake = ipnGateway(GatewayStatus::pending());

    $this->postJson(ipnUrl($tenant), ipnBody(IPN_TRACKING_ID, [
        'status' => 'COMPLETED',
        'status_code' => 1,
        'payment_status_description' => 'Completed',
        'amount' => 9_999_999,
        'confirmation_code' => 'FORGED-CONF',
        'OrderMerchantReference' => 'PAY-2608-9999',
    ]))->assertOk();

    // Exactly one thing happened: we asked Pesapal a question we were going to
    // ask anyway on the reconciliation schedule.
    expect($fake->intentsPolled)->toBe([$intent->id]);

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Pending)
            ->and($fresh?->aggregator_reference)->toBeNull()
            ->and($fresh?->resolved_at)->toBeNull();
    });

    expect(ipnAuditEvents($tenant, 'payment.resolution_applied'))->toHaveCount(0);
});

it('stores nothing from the notification body', function () {
    // There is nothing in it worth keeping — no status, no amount, no
    // signature — and keeping it would invite a later reader to believe it.
    [$tenant, , $intent] = ipnFixture();

    ipnGateway(GatewayStatus::succeeded(3_000_000, 'PESA-CONF-77'));

    $this->postJson(ipnUrl($tenant), ipnBody(IPN_TRACKING_ID, [
        'amount' => 9_999_999,
        'patient_note' => 'malaria follow-up',
    ]))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->raw_callback_payload)->toBeNull();
    });
});

// --- Rule 5: a duplicate is a no-op ---------------------------------------

it('treats a duplicate notification as a no-op', function () {
    // Pesapal retries. Without idempotency, two deliveries of one notification
    // could confirm an appointment twice and double-count a day's takings in
    // the reconciliation view.
    [$tenant, , $intent] = ipnFixture();

    $fake = ipnGateway(GatewayStatus::succeeded(3_000_000, 'PESA-CONF-77'));

    $this->postJson(ipnUrl($tenant), ipnBody())->assertOk();
    $this->postJson(ipnUrl($tenant), ipnBody())->assertOk();
    $this->getJson(ipnUrl($tenant).'?OrderTrackingId='.IPN_TRACKING_ID)->assertOk();

    // Claimed before the status call, so a replay costs one outbound request
    // per order rather than one per delivery.
    expect($fake->intentsPolled)->toHaveCount(1)
        ->and(ipnAuditEvents($tenant, 'payment.resolution_applied'))->toHaveCount(1);

    app(Tenancy::class)->run($tenant->id, function () use ($tenant, $intent) {
        $deliveries = DB::table('webhook_deliveries')
            ->where('tenant_id', $tenant->id)
            ->where('provider', 'pesapal')
            ->get();

        expect($deliveries)->toHaveCount(1)
            ->and($deliveries->first()?->provider_event_id)->toBe(IPN_TRACKING_ID)
            ->and($deliveries->first()?->outcome)->toBe(ResolutionOutcome::Applied->value)
            ->and($intent->fresh()?->status)->toBe(PaymentIntentStatus::Succeeded);
    });
});

// --- Rule 6: the fraud boundary applies unchanged --------------------------

it('flags an amount mismatch and applies no state change', function () {
    // The SAME resolver the signed Flutterwave webhook and the reconciliation
    // poll go through, which is what stops the boundary drifting between three
    // copies. A report claiming money moved is compared against the stored
    // intent, and a mismatch is flagged for the administrator — never accepted.
    [$tenant, , $intent] = ipnFixture();

    // Pesapal reporting a collection of UGX 100 against a UGX 30,000 intent.
    ipnGateway(GatewayStatus::succeeded(10_000, 'PESA-CONF-77'));

    $this->postJson(ipnUrl($tenant), ipnBody())->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Pending)
            ->and($fresh?->aggregator_reference)->toBeNull()
            ->and($fresh?->resolved_at)->toBeNull();
    });

    $flagged = ipnAuditEvents($tenant, 'payment.amount_mismatch_flagged');

    expect($flagged)->toHaveCount(1)
        ->and($flagged->first()?->metadata['source'] ?? null)->toBe('pesapal_ipn')
        ->and($flagged->first()?->metadata['expected_amount_minor'] ?? null)->toBe(3_000_000)
        ->and($flagged->first()?->metadata['reported_amount_minor'] ?? null)->toBe(10_000);

    app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        expect(DB::table('webhook_deliveries')->where('tenant_id', $tenant->id)->value('outcome'))
            ->toBe(ResolutionOutcome::AmountMismatch->value);
    });
});

// --- Rule 7: timed_out is not final ---------------------------------------

it('moves a timed-out attempt to succeeded on a late notification', function () {
    // THE critical payment rule, on the new path. A mobile-money confirmation
    // that arrives after the window still has to resolve the attempt: treating
    // a timeout as definitive failure produces the worst outcome available — a
    // patient charged for a booking that was cancelled on our side.
    [$tenant, , $intent] = ipnFixture(['status' => PaymentIntentStatus::TimedOut]);

    ipnGateway(GatewayStatus::succeeded(3_000_000, 'PESA-CONF-LATE'));

    $this->postJson(ipnUrl($tenant), ipnBody())->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($fresh?->aggregator_reference)->toBe('PESA-CONF-LATE')
            ->and($fresh?->next_poll_at)->toBeNull();
    });
});

// --- When Pesapal itself cannot be read ------------------------------------

it('answers 200 and leaves the attempt to reconciliation when Pesapal cannot be read', function () {
    // Retrying a notification will not make Pesapal reachable, and an error
    // status invites it to hammer a public endpoint. A webhook is never the
    // only path to resolution in this system: the scheduled poll performs the
    // same read.
    [$tenant, , $intent] = ipnFixture();

    $fake = new FakePesapal;
    $fake->willFail();
    app()->instance(PaymentGateway::class, $fake);

    $this->postJson(ipnUrl($tenant), ipnBody())->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($tenant, $intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending)
            ->and(DB::table('webhook_deliveries')->where('tenant_id', $tenant->id)->value('outcome'))
            // "We heard, and could not read" — a different problem from "we
            // never heard", and a support conversation needs to tell them apart.
            ->toBe(ResolutionOutcome::Received->value);
    });
});

// --- The route itself -------------------------------------------------------

it('is not routed through the signature-verifying controller', function () {
    // Registration order decides this. If `webhooks/{provider}/{tenant}` were
    // matched first, every Pesapal notification would be rejected as unsigned —
    // a failure indistinguishable from a misconfigured clinic.
    [$tenant] = ipnFixture();

    ipnGateway(GatewayStatus::pending());

    // No signature header, and the signed-callback controller would answer 401.
    $this->postJson(ipnUrl($tenant), ipnBody())->assertOk();
});
