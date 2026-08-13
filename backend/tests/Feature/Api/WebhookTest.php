<?php

use App\Models\AggregatorAccount;
use App\Models\AuditEvent;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Services\Payments\ResolutionOutcome;
use App\Tenancy\Tenancy;
use Database\Factories\AggregatorAccountFactory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Inbound aggregator webhooks
|--------------------------------------------------------------------------
|
| The endpoint that decides whether a patient's appointment is confirmed, and
| it is unauthenticated by nature. Two boundaries carry the design: signature
| verification (step 3) and amount validation (step 8). Both are tested for
| what they REFUSE, because that is the half that matters.
|
| See docs/40-api/webhooks.md
|
*/

const WEBHOOK_SECRET = 'whsec_test_kampala';

/**
 * @param  array<string, mixed>  $intentAttributes
 * @return array{Tenant, AggregatorAccount, PaymentIntent}
 */
function webhookFixture(array $intentAttributes = []): array
{
    $tenant = Tenant::factory()->create();

    [$account, $intent] = app(Tenancy::class)->run($tenant->id, fn (): array => [
        AggregatorAccountFactory::new()->withWebhookSecret(WEBHOOK_SECRET)->createOne(),
        PaymentIntent::factory()->create($intentAttributes),
    ]);

    return [$tenant, $account, $intent];
}

/**
 * @param  array<string, mixed>  $overrides  merged into the transaction object
 * @return array<string, mixed>
 */
function webhookPayload(PaymentIntent $intent, array $overrides = []): array
{
    return [
        'event' => 'charge.completed',
        'data' => array_merge([
            'id' => 'FLW-EVENT-0001',
            'tx_ref' => $intent->reference,
            'flw_ref' => 'FLW-TX-9911',
            'status' => 'successful',
            // Major units, as an aggregator sends them. The stored intent holds
            // 3,000,000 minor units.
            'amount' => 30000,
            'currency' => 'UGX',
            'customer' => ['phone_number' => '+256700000001', 'email' => 'p@example.test'],
        ], $overrides),
    ];
}

/**
 * The arguments for one delivery: url, body, headers.
 *
 * Spread straight into postJson. The signature is computed over the bytes
 * postJson will send -- the same array through the same encoder -- because a
 * signature verified against a re-encoding would not be a test of anything.
 *
 * @param  array<string, mixed>  $payload
 * @return array{string, array<string, mixed>, array<string, string>}
 */
function webhookRequest(
    Tenant $tenant,
    array $payload,
    ?string $secret = WEBHOOK_SECRET,
    string $provider = 'flutterwave',
    ?string $tenantSegment = null,
): array {
    $headers = [];

    if ($secret !== null) {
        $headers['X-Webhook-Signature'] = hash_hmac('sha256', json_encode($payload) ?: '', $secret);
    }

    return [
        sprintf('/api/webhooks/%s/%s', $provider, $tenantSegment ?? $tenant->id),
        $payload,
        $headers,
    ];
}

/** @return Collection<int, AuditEvent> */
function webhookAuditEvents(Tenant $tenant, string $action): Collection
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn () => AuditEvent::query()->where('action', $action)->get()
    );
}

it('accepts a correctly signed callback and resolves the intent', function () {
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent)))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        $fresh = $intent->fresh();

        expect($fresh?->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($fresh?->aggregator_reference)->toBe('FLW-TX-9911')
            ->and($fresh?->resolved_at)->not->toBeNull();
    });
});

it('rejects an invalid signature with 401 and writes an audit event', function () {
    // THE security boundary. An invalid signature is not a client error to be
    // quietly discarded -- it is either a misconfiguration or an attempt to
    // forge a payment confirmation, and both deserve a permanent record.
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent), secret: 'not-the-secret'))
        ->assertStatus(401);

    expect(webhookAuditEvents($tenant, 'payment.webhook_signature_rejected'))->toHaveCount(1);

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending);
    });
});

it('does not trust the tenant in the path until the signature verifies', function () {
    // A forged tenant segment fails verification against THAT tenant's secret.
    // The path is the one place tenancy comes from the request, and this is
    // the only thing that makes it safe.
    [$tenantA, , $intentA] = webhookFixture();
    $tenantB = Tenant::factory()->create();

    app(Tenancy::class)->run(
        $tenantB->id,
        fn () => AggregatorAccountFactory::new()->withWebhookSecret('whsec_test_other')->create()
    );

    // Signed with tenant B's secret, but aimed at tenant A.
    $this->postJson(...webhookRequest($tenantA, webhookPayload($intentA), secret: 'whsec_test_other'))
        ->assertStatus(401);

    app(Tenancy::class)->run($tenantA->id, function () use ($intentA) {
        expect($intentA->fresh()?->status)->toBe(PaymentIntentStatus::Pending);
    });
});

it('treats a duplicate delivery as a no-op', function () {
    // Aggregators retry. Without idempotency, two deliveries of one success
    // callback could confirm an appointment twice.
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent)))->assertOk();
    $this->postJson(...webhookRequest($tenant, webhookPayload($intent)))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect(DB::table('webhook_deliveries')->count())->toBe(1)
            ->and($intent->fresh()?->status)->toBe(PaymentIntentStatus::Succeeded);
    });

    // Applied exactly once, not twice.
    expect(webhookAuditEvents($tenant, 'payment.resolution_applied'))->toHaveCount(1);
});

it('flags an amount mismatch and changes no state', function () {
    // THE fraud boundary. Accepting a callback's word on the amount would let a
    // forged or replayed payload confirm a large booking against a small
    // payment.
    [$tenant, , $intent] = webhookFixture(['amount_minor' => 3_000_000]);

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent, ['amount' => 100])))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending)
            ->and($intent->fresh()?->resolved_at)->toBeNull()
            ->and(DB::table('webhook_deliveries')->value('outcome'))
            ->toBe(ResolutionOutcome::AmountMismatch->value);
    });

    $flag = webhookAuditEvents($tenant, 'payment.amount_mismatch_flagged')->first();

    expect($flag)->not->toBeNull();

    $metadata = $flag->metadata ?? [];

    expect($metadata['expected_amount_minor'] ?? null)->toBe(3_000_000)
        ->and($metadata['reported_amount_minor'] ?? null)->toBe(10_000);
});

it('returns 200 for an unknown reference', function () {
    // Retrying us forever will not conjure the intent into existence, and an
    // error status encourages the aggregator to hammer a public endpoint.
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent, ['tx_ref' => 'PAY-2608-0000'])))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending)
            ->and(DB::table('webhook_deliveries')->count())->toBe(0);
    });
});

it('records an explicit failure with the aggregator reason verbatim', function () {
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent, [
        'status' => 'failed',
        'failure_code' => 'INSUFFICIENT_FUNDS',
        'failure_message' => 'The subscriber has insufficient funds.',
    ])))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Failed)
            ->and($intent->fresh()?->failure_message)->toBe('The subscriber has insufficient funds.');
    });
});

it('resolves a timed-out intent on a late callback', function () {
    // timed_out is NOT final. Treating a timeout as definitive failure produces
    // the worst outcome available: a patient charged for a cancelled booking.
    [$tenant, , $intent] = webhookFixture(['status' => PaymentIntentStatus::TimedOut]);

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent)))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Succeeded);
    });
});

it('returns 404 when the tenant has no webhook secret configured', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run(
        $tenant->id,
        fn () => AggregatorAccountFactory::new()->unconfigured()->create()
    );

    $this->postJson(...webhookRequest($tenant, ['event' => 'charge.completed', 'data' => ['id' => 'X', 'tx_ref' => 'Y', 'status' => 'successful', 'amount' => 1]]))
        ->assertNotFound();
});

it('returns 404 for an unknown tenant', function () {
    $tenant = Tenant::factory()->create();

    $this->postJson(...webhookRequest($tenant, ['event' => 'charge.completed'], tenantSegment: 'not-a-clinic'))
        ->assertNotFound();
});

it('returns 400 for a payload carrying no reference', function () {
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent, ['tx_ref' => null])))->assertStatus(400);
});

it('refuses to guess at a status word it does not recognise', function () {
    // Guessing here would mean inventing a payment outcome, and the failure
    // modes are asymmetric: reading an unknown word as success confirms a
    // booking nobody paid for.
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent, ['status' => 'quantum'])))->assertStatus(400);

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->fresh()?->status)->toBe(PaymentIntentStatus::Pending);
    });
});

it('never returns a webhook secret, whatever the outcome', function () {
    // Secrets are write-only. Not readable by the administrator who entered
    // them, and not by us.
    [$tenant, , $intent] = webhookFixture();

    $responses = [
        $this->postJson(...webhookRequest($tenant, webhookPayload($intent))),
        $this->postJson(...webhookRequest($tenant, webhookPayload($intent), secret: 'wrong')),
        $this->postJson(...webhookRequest($tenant, webhookPayload($intent), tenantSegment: 'nope')),
    ];

    foreach ($responses as $response) {
        $response->assertDontSee(WEBHOOK_SECRET, escape: false);
    }
});

it('redacts payer contact details from the stored callback', function () {
    // The payload is kept for dispute resolution. That usefulness lasts years,
    // and so does the liability.
    [$tenant, , $intent] = webhookFixture();

    $this->postJson(...webhookRequest($tenant, webhookPayload($intent)))->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        $stored = json_encode($intent->fresh()?->raw_callback_payload) ?: '';

        expect($stored)->not->toContain('+256700000001')
            ->and($stored)->not->toContain('p@example.test')
            ->and($stored)->toContain('FLW-TX-9911');
    });
});
