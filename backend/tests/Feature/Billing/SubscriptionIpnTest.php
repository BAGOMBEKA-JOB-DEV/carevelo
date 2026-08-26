<?php

use App\Models\AuditEvent;
use App\Models\PlatformSubscriptionCharge;
use App\Models\SubscriptionChargeStatus;
use App\Models\SubscriptionPlan;
use App\Models\Tenant;
use App\Support\Money;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/*
|--------------------------------------------------------------------------
| The subscription notification — a hint about OUR OWN money, and nothing more
|--------------------------------------------------------------------------
|
| Pesapal's notification carries OrderTrackingId, OrderMerchantReference and
| OrderNotificationType. NO STATUS. NO AMOUNT. NO SIGNATURE, and no shared secret
| with which one could be computed. ADR-0012 exists so that nobody "fixes" that
| by trusting the body, and everything below is a way of saying so.
|
| THIS ENDPOINT HAS ONE HAZARD ITS NEIGHBOUR DOES NOT. A recurring transaction is
| initiated by PESAPAL, months after the subscription was created, so its
| tracking id is one this system has never seen and cannot look anything up by —
| and NOTHING in the notification says which clinic it concerns.
| `OrderNotificationType: RECURRING` says only what kind of event it is.
|
| The clinic is named by `subscription_transaction_info.account_reference` in the
| GetTransactionStatus RESPONSE: the `account_number` we set at subscription
| time, echoed back over an authenticated TLS connection by the party that took
| the money. Every test here holds that line — including the ones where the
| notification body helpfully supplies a status, an amount and a clinic of its
| own, all of which must be ignored completely.
|
| So the most a forged notification can achieve is to make us ask Pesapal a
| question and receive Pesapal's honest answer.
|
| See docs/70-decisions/0012-pesapal-unsigned-ipn.md
| See docs/70-decisions/0003-non-custodial-payment-architecture.md
|
*/

const SUB_IPN_KEY = 'SUBIPNCONSUMERKEY-mm44kk';
const SUB_IPN_SECRET = 'SUBIPNCONSUMERSECRET-mm44kk';
const SUB_IPN_TOKEN = 'subipn.jwt.mm44kk.bearer';
const SUB_IPN_TRACKING = '9f3b7c22-11ae-4c8d-9d55-77aa33bb99cc';

/** No tenant in the path, and there is nowhere for one to come from. */
const PESAPAL_BILLING_URL = '/api/webhooks/pesapal-billing';

beforeEach(function () {
    Http::preventStrayRequests();

    config([
        'billing.pesapal.consumer_key' => SUB_IPN_KEY,
        'billing.pesapal.consumer_secret' => SUB_IPN_SECRET,
        'billing.pesapal.environment' => 'sandbox',
        'billing.pesapal.ipn_id' => 'ipn-platform-ipn-test',
    ]);
});

/**
 * What Pesapal answers GetTransactionStatus with.
 *
 * THE ONLY SOURCE OF TRUTH in this file. Every fact the system acts on comes
 * from here, and every test that supplies a contradictory notification body is
 * asserting that this is what won.
 *
 * @param  array<string, mixed>  $status
 */
function subIpnPesapal(array $status): void
{
    Http::fake([
        '*/api/Auth/RequestToken' => Http::response(['token' => SUB_IPN_TOKEN]),
        '*/api/Transactions/GetTransactionStatus*' => Http::response($status),
    ]);
}

/**
 * A COMPLETED recurring transaction of $shillings, for $tenant.
 *
 * @return array<string, mixed>
 */
function subIpnCompleted(Tenant $tenant, int $shillings = 250_000): array
{
    return [
        // Pesapal reports an INTEGER, and 0 and 1 both look reasonable and mean
        // opposite things. 1 is COMPLETED.
        'status_code' => 1,
        // MAJOR units on the wire.
        'amount' => $shillings,
        'confirmation_code' => 'PESA-SUB-9001',
        'subscription_transaction_info' => [
            // The `account_number` we set at subscription time: the tenant id.
            'account_reference' => $tenant->id,
        ],
    ];
}

/**
 * The body Pesapal actually POSTs for a recurring charge.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function subIpnBody(array $overrides = []): array
{
    return array_merge([
        'OrderTrackingId' => SUB_IPN_TRACKING,
        'OrderMerchantReference' => 'SUB-01JXXXX',
        'OrderNotificationType' => 'RECURRING',
    ], $overrides);
}

function subIpnClinic(int $shillings = 250_000, ?string $paidThrough = null): Tenant
{
    $tenant = Tenant::factory()->create();

    $tenant->plan = SubscriptionPlan::Clinic;
    $tenant->plan_price = Money::ugx($shillings);

    if ($paidThrough !== null) {
        $tenant->current_period_ends_at = Carbon::parse($paidThrough);
    }

    $tenant->save();

    return $tenant;
}

// --- Rule 3: the truth comes from GetTransactionStatus ------------------

it('resolves a RECURRING notification from the status call, for a transaction it has never seen', function () {
    // The ordinary month-two case. Pesapal initiated this charge on the schedule
    // it was given; the tracking id is new to us, and the ONLY thing telling us
    // which clinic paid is account_reference in Pesapal's answer.
    $tenant = subIpnClinic();

    subIpnPesapal(subIpnCompleted($tenant));

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())
        ->assertOk()
        ->assertExactJson(['received' => true]);

    $charge = PlatformSubscriptionCharge::query()->firstOrFail();

    expect($charge->tenant_id)->toBe($tenant->id)
        ->and($charge->status)->toBe(SubscriptionChargeStatus::Succeeded)
        ->and($charge->aggregator_tracking_id)->toBe(SUB_IPN_TRACKING)
        ->and($charge->aggregator_reference)->toBe('PESA-SUB-9001')
        // The amount stored is the one the clinic AGREED, from its register row
        // -- never the one Pesapal reported. A row built from the reported
        // amount would agree with itself and the fraud boundary would be inert.
        ->and($charge->amount->amountMinor)->toBe(25_000_000);

    // And the clinic is now paid through the end of the period it bought.
    expect($tenant->refresh()->current_period_ends_at)->not->toBeNull();

    // The status was READ. This is the assertion ADR-0012 exists to protect.
    Http::assertSent(fn (ClientRequest $request) => str_contains($request->url(), 'GetTransactionStatus')
        && str_contains($request->url(), SUB_IPN_TRACKING));
});

it('ignores a status, an amount and a clinic supplied in the notification body', function () {
    // THE TEST THIS FILE EXISTS FOR. The body below is what an attacker would
    // send: a success, a large amount, and somebody else's clinic. Pesapal's
    // answer says the transaction FAILED and names a different clinic, and the
    // answer is what the system acts on.
    //
    // A future "optimisation" that reads a status out of the body to save a
    // round trip fails here, loudly, which is the point.
    $payer = subIpnClinic();
    $victim = subIpnClinic();

    subIpnPesapal([
        'status_code' => 2, // FAILED
        'error' => ['code' => 'insufficient_funds', 'message' => 'no funds'],
        'subscription_transaction_info' => ['account_reference' => $payer->id],
    ]);

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody([
        'status_code' => 1,
        'status' => 'COMPLETED',
        'payment_status_description' => 'Completed',
        'amount' => 250_000,
        'confirmation_code' => 'FORGED-CONF',
        'account_reference' => $victim->id,
        'subscription_transaction_info' => ['account_reference' => $victim->id],
    ]))->assertOk();

    $charge = PlatformSubscriptionCharge::query()->firstOrFail();

    expect($charge->tenant_id)->toBe($payer->id)
        ->and($charge->status)->toBe(SubscriptionChargeStatus::Failed)
        ->and($charge->failure_code)->toBe('insufficient_funds')
        // Not the forged confirmation code, and not the forged clinic.
        ->and($charge->aggregator_reference)->toBeNull();

    // Neither clinic gained a paid-through date from a failed collection.
    expect($payer->refresh()->current_period_ends_at)->toBeNull()
        ->and($victim->refresh()->current_period_ends_at)->toBeNull();
});

it('does not read the notification type, so RECURRING and IPNCHANGE are treated identically', function () {
    // OrderNotificationType is a field an anonymous caller chooses. Branching on
    // it would make the trusted path selectable by the forger.
    $tenant = subIpnClinic();

    subIpnPesapal(subIpnCompleted($tenant));

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody(['OrderNotificationType' => 'ANYTHING-AT-ALL']))->assertOk();

    expect(PlatformSubscriptionCharge::query()->where('status', SubscriptionChargeStatus::Succeeded)->count())
        ->toBe(1);
});

// --- Rule 4: a forged notification changes nothing ----------------------

it('changes nothing when Pesapal has never heard of the tracking id', function () {
    // status_code 0 is INVALID: Pesapal has nothing for this order. Not an
    // error, and emphatically not a success. A guessed tracking id gets exactly
    // this, and exactly nothing.
    $tenant = subIpnClinic();

    subIpnPesapal(['status_code' => 0]);

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody(['OrderTrackingId' => 'guessed-0000-0000']))->assertOk();

    expect(PlatformSubscriptionCharge::query()->count())->toBe(0)
        ->and($tenant->refresh()->current_period_ends_at)->toBeNull();
});

it('changes nothing when Pesapal reports no subscription information', function () {
    // A transaction Pesapal reports without subscription information is one we
    // cannot attribute, and an unattributable payment extends nobody's
    // subscription. Guessing the clinic would be the whole vulnerability.
    $tenant = subIpnClinic();

    subIpnPesapal([
        'status_code' => 1,
        'amount' => 250_000,
        'confirmation_code' => 'PESA-SUB-ORPHAN',
    ]);

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())->assertOk();

    expect(PlatformSubscriptionCharge::query()->count())->toBe(0)
        ->and($tenant->refresh()->current_period_ends_at)->toBeNull();

    expect(AuditEvent::query()->where('action', 'platform.subscription_unattributable')->count())->toBe(1);
});

it('refuses a reported amount that disagrees with what the clinic agreed to pay', function () {
    // THE FRAUD BOUNDARY. Without it, anyone able to make Pesapal report
    // anything could extend a clinic's subscription for the price of the
    // smallest transaction Pesapal will process. A mismatch applies NO state
    // change, ever, and is flagged for a person.
    $tenant = subIpnClinic(250_000);

    subIpnPesapal(subIpnCompleted($tenant, 100));

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())->assertOk();

    $charge = PlatformSubscriptionCharge::query()->firstOrFail();

    expect($charge->status)->toBe(SubscriptionChargeStatus::Initiated)
        ->and($charge->resolved_at)->toBeNull()
        ->and($tenant->refresh()->current_period_ends_at)->toBeNull();

    expect(AuditEvent::query()->where('action', 'platform.subscription_amount_mismatch')->count())->toBe(1);
});

it('extends a clinic\'s paid-through date once, however many times the notification is replayed', function () {
    // Idempotency has two layers and both are asserted, because each covers a
    // failure the other does not.
    //
    // The LEDGER claim stops a replay costing a second outbound request, which
    // is what bounds an unauthenticated public endpoint's cost.
    //
    // The `already there` check in the resolver is what stops a paid-through
    // date being extended twice -- and it is the one that would still hold if
    // the ledger were ever emptied.
    $tenant = subIpnClinic();

    subIpnPesapal(subIpnCompleted($tenant));

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())->assertOk();

    $paidThrough = $tenant->refresh()->current_period_ends_at;

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())->assertOk();
    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())->assertOk();

    expect(PlatformSubscriptionCharge::query()->count())->toBe(1)
        ->and($tenant->refresh()->current_period_ends_at?->toIso8601String())
        ->toBe($paidThrough?->toIso8601String());

    // One status call for three deliveries. The claim happens BEFORE the call
    // precisely so a replay cannot make us hammer Pesapal.
    $statusCalls = 0;

    Http::assertSent(function (ClientRequest $request) use (&$statusCalls) {
        if (str_contains($request->url(), 'GetTransactionStatus')) {
            $statusCalls++;
        }

        return true;
    });

    expect($statusCalls)->toBe(1);
});

it('answers a neutral 404 and calls nobody when the platform has no merchant account', function () {
    // The endpoint is public. An error distinguishing "not configured" from
    // "not found" tells an anonymous caller about our deployment.
    config(['billing.pesapal.consumer_key' => null, 'billing.pesapal.consumer_secret' => null]);

    Http::fake();

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())
        ->assertNotFound()
        ->assertJsonPath('code', 'not_found');

    Http::assertNothingSent();

    expect(DB::table('platform_billing_notifications')->count())->toBe(0);
});

it('answers 200 without changing anything when Pesapal cannot be read', function () {
    // Pesapal retrying will not make Pesapal reachable, and an error status
    // invites it to hammer a public endpoint. The delivery stays `received`,
    // which is the honest description: we heard, and could not read.
    $tenant = subIpnClinic();

    Http::fake([
        '*/api/Auth/RequestToken' => Http::response(['token' => SUB_IPN_TOKEN]),
        '*/api/Transactions/GetTransactionStatus*' => Http::response('nonsense', 500),
    ]);

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody())->assertOk()->assertExactJson(['received' => true]);

    expect(PlatformSubscriptionCharge::query()->count())->toBe(0)
        ->and($tenant->refresh()->current_period_ends_at)->toBeNull()
        ->and(DB::table('platform_billing_notifications')->where('outcome', 'received')->count())->toBe(1);
});

it('rejects a tracking id long enough to poison the idempotency index', function () {
    Http::fake();

    $this->postJson(PESAPAL_BILLING_URL, subIpnBody(['OrderTrackingId' => str_repeat('a', 101)]))
        ->assertNotFound();

    Http::assertNothingSent();
});

// --- The route itself ---------------------------------------------------

it('routes a billing notification to the platform controller, never to a clinic\'s', function () {
    // Routes match in registration order and routers get reordered. If this ever
    // reached PesapalIpnController, `pesapal-billing` would be read as a TENANT
    // slug and every subscription notification would 404 -- indistinguishable
    // from a misconfigured merchant account.
    $route = app('router')->getRoutes()->getByName('webhooks.pesapal-billing');

    expect($route)->not->toBeNull()
        ->and($route?->getActionName())
        ->toContain('PlatformBillingIpnController');

    // And it takes no tenant. A tenant segment here would be a field an
    // anonymous caller chooses, sitting next to a resolver that must not read
    // one.
    expect($route?->parameterNames())->toBe([]);
});
