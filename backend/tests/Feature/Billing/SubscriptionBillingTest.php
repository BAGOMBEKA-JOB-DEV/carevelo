<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\PaymentIntent;
use App\Models\PlatformSubscriptionCharge;
use App\Models\SubscriptionChargeStatus;
use App\Models\SubscriptionPlan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Money;
use App\Tenancy\Tenancy;
use Database\Factories\AggregatorAccountFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| Clinic subscription billing — the money that IS ours
|--------------------------------------------------------------------------
|
| Carevelo is the merchant here, and that inverts every invariant the patient
| payment path relies on. ADR-0003 permits exactly this and nothing more —
| "Revenue is subscription-only (§F)" — so the tests in this file are not about
| a feature working. They are about a boundary holding.
|
| The boundary, stated as the four things that must remain true:
|
|   1. A clinic's SUBSCRIPTION charge never touches `aggregator_accounts` or
|      `payment_intents`. Clinic money and Carevelo money share no table, no
|      account lookup and no resolver — because one shared code path is how
|      custody arrives by accident, and custody is the NPS Act 2020 PSP and
|      e-money categories at UGX 250m–10bn of capital.
|
|   2. Platform billing rows are invisible from inside a tenant, in BOTH
|      directions. Enforced by PostgreSQL, not by every future query being
|      careful.
|
|   3. The platform's own Pesapal credentials reach no response body, no log
|      line and no audit event — the same assertion H1 makes about a clinic's,
|      with the same helper, because ours are no less dangerous than theirs.
|
|   4. The recurring instruction Pesapal receives says what we mean: the tenant
|      id as `account_number`, MONTHLY, and dd-MM-yyyy dates.
|
| See docs/70-decisions/0003-non-custodial-payment-architecture.md
| See docs/70-decisions/0012-pesapal-unsigned-ipn.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    // Nothing in this file may reach the internet. A stray request would mean a
    // test was exercising a path the fakes do not cover, and passing anyway.
    Http::preventStrayRequests();

    /*
     * Sanctum starts a session only for a request whose Origin or Referer host
     * is stateful. A browser always sends one and Laravel's test client never
     * does, so without this RequireSecondFactor finds no verified stamp and
     * every platform call answers 403. See PlatformTenantTest.
     */
    $this->withHeader('Referer', sprintf(
        'http://%s/',
        parse_url((string) config('app.url'), PHP_URL_HOST),
    ));
});

/**
 * Deliberately distinctive strings.
 *
 * A substring search for them across every response body, log line and audit
 * event is the whole of the secrets assertion below, so they must not collide
 * with anything the framework emits.
 */
const PLATFORM_CONSUMER_KEY = 'PLATFORMCONSUMERKEY-zz99xx';
const PLATFORM_CONSUMER_SECRET = 'PLATFORMCONSUMERSECRET-zz99xx';
const PLATFORM_BEARER_TOKEN = 'platform.jwt.zz99xx.bearer';
const PLATFORM_IPN_ID = 'ipn-platform-0001';
const PLATFORM_TRACKING_ID = 'c1f3a9de-2b77-4d51-9d0a-1f0b2c3d4e5f';

/** Carevelo's own merchant account, as production would configure it. */
function billingConfigured(): void
{
    config([
        'billing.pesapal.consumer_key' => PLATFORM_CONSUMER_KEY,
        'billing.pesapal.consumer_secret' => PLATFORM_CONSUMER_SECRET,
        'billing.pesapal.environment' => 'sandbox',
        'billing.pesapal.ipn_id' => PLATFORM_IPN_ID,
    ]);
}

/**
 * The whole platform-facing Pesapal API, faked at the wire.
 *
 * Http::fake rather than a port double, because two of the claims here are
 * properties of what goes ON THE WIRE — the recurring instruction's shape, and
 * the fact that a credential never comes back out of it. A fake with no HTTP in
 * it cannot prove either.
 *
 * @param  array<string, mixed>  $statusBody
 */
function billingHttp(array $statusBody = []): void
{
    Http::fake([
        '*/api/Auth/RequestToken' => Http::response([
            'token' => PLATFORM_BEARER_TOKEN,
            'expiryDate' => now()->addMinutes(5)->toIso8601String(),
        ]),
        '*/api/Transactions/SubmitOrderRequest' => Http::response([
            'order_tracking_id' => PLATFORM_TRACKING_ID,
            'merchant_reference' => 'SUB-TEST',
            // Must be on the sandbox host, or the client refuses to send a
            // browser to it. That refusal has its own test elsewhere.
            'redirect_url' => 'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId='.PLATFORM_TRACKING_ID,
        ]),
        '*/api/Transactions/GetTransactionStatus*' => Http::response(array_merge([
            'status_code' => 1,
            'amount' => 250_000,
            'confirmation_code' => 'PESA-SUB-4411',
            'subscription_transaction_info' => ['account_reference' => 'set-per-test'],
        ], $statusBody)),
    ]);
}

/** A Carevelo operator: no tenant_id, because we belong to no clinic. */
function billingOperator(ClinicalRole $role = ClinicalRole::PlatformAdmin): User
{
    $user = User::factory()->create(['tenant_id' => null]);
    $user->assignRole($role->value);

    return $user;
}

/** Cross-tenant routes have no tenant host to be addressed on. */
function billingUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/** A clinic with a plan and a price already agreed. */
function billedClinic(int $monthlyShillings = 250_000): Tenant
{
    $tenant = Tenant::factory()->create();

    $tenant->plan = SubscriptionPlan::Clinic;
    $tenant->plan_price = Money::ugx($monthlyShillings);
    $tenant->save();

    return $tenant;
}

/**
 * Every log line written while the callback runs.
 *
 * A copy of h1PayCapturedLog() from tests/Feature/Api/Admin/AggregatorAccountTest.php,
 * deliberately rather than a shared import: that one asserts a CLINIC'S
 * credentials never escape, this one asserts CAREVELO'S never do, and the two
 * claims should not be able to break together.
 *
 * Log::listen sees everything that reaches the logger, so this catches a secret
 * escaping through a debug line, a warning, or an exception trace someone
 * decided to report.
 *
 * @return list<string>
 */
function billingCapturedLog(callable $callback): array
{
    $lines = [];

    Log::listen(function (MessageLogged $logged) use (&$lines): void {
        $lines[] = $logged->message.' '.(json_encode($logged->context) ?: '');
    });

    $callback();

    return $lines;
}

// --- Rule 1: the two money paths share nothing --------------------------

it('never touches aggregator_accounts or payment_intents while charging a clinic', function () {
    // THE ASSERTION THAT MAKES ADR-0003 A PROPERTY OF THE CODE RATHER THAN A
    // PARAGRAPH. Both tables exist, are populated, and are one careless join
    // away — so the proof is not "there is no relation in the model", it is a
    // watch on every statement the database actually receives.
    billingConfigured();
    billingHttp();

    $tenant = billedClinic();

    // A clinic that is fully set up on the PATIENT path: its own aggregator
    // account, and a patient payment attempt against it. If subscription
    // billing were ever to reach for "the account for this tenant", this is the
    // row it would find.
    app(Tenancy::class)->run($tenant->id, function (): void {
        AggregatorAccountFactory::new()->pesapal()->createOne();
        PaymentIntent::factory()->create(['aggregator' => 'pesapal']);
    });

    $statements = [];

    DB::listen(function ($query) use (&$statements): void {
        $statements[] = strtolower($query->sql);
    });

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertCreated();

    $forbidden = array_values(array_filter(
        $statements,
        fn (string $sql) => str_contains($sql, 'aggregator_accounts') || str_contains($sql, 'payment_intents'),
    ));

    expect($forbidden)->toBeEmpty(
        "A subscription charge reached the patient payment path:\n".implode("\n", $forbidden)
    );

    // And it did do the work, so the emptiness above is not the emptiness of a
    // request that never ran.
    expect(PlatformSubscriptionCharge::query()->where('tenant_id', $tenant->id)->count())->toBe(1);
});

it('collects into the platform account even when the clinic has none of its own', function () {
    // The inverse of the rule above, and the one that would fail silently. A
    // clinic with no aggregator account can still be billed, because the
    // merchant is Carevelo — if subscription billing depended on the clinic's
    // account in any way, this is where it would surface.
    billingConfigured();
    billingHttp();

    $tenant = billedClinic();

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertCreated()
        ->assertJsonPath('data.aggregator_tracking_id', PLATFORM_TRACKING_ID);

    // Authenticated with OUR consumer key. Not a clinic's, and there was no
    // clinic's to reach for.
    Http::assertSent(fn (ClientRequest $request) => str_contains($request->url(), 'RequestToken')
        && $request['consumer_key'] === PLATFORM_CONSUMER_KEY);
});

it('refuses to bill rather than falling back to anything when the platform is unconfigured', function () {
    // Unconfigured must mean COLLECT NOTHING. The only other Pesapal credentials
    // in this system belong to clinics, and a fallback to one of those would
    // collect Carevelo's fee into a clinic's merchant account — both a theft and
    // the exact blending of the two money paths this domain exists to prevent.
    $tenant = billedClinic();

    app(Tenancy::class)->run(
        $tenant->id,
        fn () => AggregatorAccountFactory::new()->pesapal()->createOne(),
    );

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertStatus(503)
        ->assertJsonPath('code', 'billing_unavailable');

    expect(PlatformSubscriptionCharge::query()->count())->toBe(0);
});

// --- Rule 2: invisible from inside a tenant, in both directions ----------

it('hides platform billing rows from inside a tenant, and tenant payment rows from the platform', function () {
    $tenant = billedClinic();

    $charge = PlatformSubscriptionCharge::factory()->create(['tenant_id' => $tenant->id]);

    // The platform, with no tenant bound, sees its own row and NOT the clinic's
    // payment attempt. That direction is the ordinary tenant isolation policy.
    $intentId = app(Tenancy::class)->run($tenant->id, function (): string {
        AggregatorAccountFactory::new()->pesapal()->createOne();

        return PaymentIntent::factory()->create()->id;
    });

    expect(PlatformSubscriptionCharge::query()->count())->toBe(1)
        ->and(DB::table('payment_intents')->count())->toBe(0)
        ->and(DB::table('aggregator_accounts')->count())->toBe(0);

    // And from inside the clinic, the mirror image: its own payment attempt is
    // there, and the platform's record of what Carevelo charges it is not.
    app(Tenancy::class)->run($tenant->id, function () use ($intentId, $charge): void {
        expect(PaymentIntent::query()->whereKey($intentId)->exists())->toBeTrue()
            ->and(PlatformSubscriptionCharge::query()->count())->toBe(0)
            // Through the model AND through the query builder, because the
            // control is the database's and not Eloquent's. A global scope
            // would be bypassed by the second of these; a policy is not.
            ->and(DB::table('platform_subscription_charges')->count())->toBe(0)
            ->and(DB::table('platform_billing_notifications')->count())->toBe(0);

        // Not even by primary key. `find()` is the lookup that looks entirely
        // normal in a diff and is the one an accidental cross-boundary read
        // usually arrives as.
        expect(PlatformSubscriptionCharge::query()->find($charge->id))->toBeNull();
    });
});

it('refuses to let a tenant session write a platform billing row', function () {
    // Reads being empty is half a control. Without WITH CHECK, a clinic session
    // could insert into a table it cannot read — which is how an attacker with
    // application-level code execution would forge a paid subscription.
    $tenant = billedClinic();

    app(Tenancy::class)->run($tenant->id, function () use ($tenant): void {
        // The inner DB::transaction() is a SAVEPOINT, and it is here for a
        // PostgreSQL reason rather than a stylistic one: a statement refused by
        // a row-level-security policy aborts the whole transaction, and every
        // subsequent statement -- including the set_config() that Tenancy::run()
        // issues on its way out -- then fails with 25P02. Rolling back to a
        // savepoint clears the aborted state, so the refusal can be asserted
        // without poisoning the test's surrounding transaction.
        $write = fn () => DB::transaction(
            fn () => PlatformSubscriptionCharge::factory()->create(['tenant_id' => $tenant->id])
        );

        expect($write)->toThrow(QueryException::class);
    });

    // Nothing landed, seen from where such a row would be visible if it had.
    expect(PlatformSubscriptionCharge::query()->count())->toBe(0);
});

it('declares both platform billing tables as platform-scoped, with a reason', function () {
    // SchemaConformanceTest presumes a new table is tenant-scoped. These two are
    // not, and saying so has to be a visible act with a reason attached rather
    // than an omission — so this asserts the declaration exists as well as the
    // policy that backs it.
    $comments = DB::select("
        select c.relname as table_name, obj_description(c.oid, 'pg_class') as comment
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('platform_subscription_charges', 'platform_billing_notifications')
    ");

    expect($comments)->toHaveCount(2);

    foreach ($comments as $table) {
        expect((string) $table->comment)->toStartWith('platform-scoped:')
            ->and(trim(str_replace('platform-scoped:', '', (string) $table->comment)))->not->toBe('');
    }

    // RLS enabled AND forced. Without FORCE the table OWNER is exempt, so the
    // migrator — and anything else owning the table — reads every row.
    $flags = DB::select("
        select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('platform_subscription_charges', 'platform_billing_notifications')
    ");

    foreach ($flags as $table) {
        expect((bool) $table->enabled)->toBeTrue("{$table->table_name}: RLS not enabled")
            ->and((bool) $table->forced)->toBeTrue("{$table->table_name}: RLS not FORCED");
    }
});

// --- Rule 3 (partial): what the recurring instruction actually says -------

it('sends the tenant id as account_number, MONTHLY, and dd-MM-yyyy dates', function () {
    // Every one of these is load-bearing rather than a shape to match.
    //
    // account_number is what Pesapal echoes back on every recurring transaction
    // as `account_reference`, and it is the ONLY statement of which clinic paid
    // that this system will ever act on. A legal name here would both break the
    // resolver and tell Pesapal's staff which clinics use Carevelo.
    //
    // dd-MM-yyyy is Pesapal's format and is used nowhere else in this codebase.
    // Sent in any other shape it is silently rejected.
    billingConfigured();
    billingHttp();

    $tenant = billedClinic(250_000);

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertCreated();

    Http::assertSent(function (ClientRequest $request) use ($tenant) {
        if (! str_contains($request->url(), 'SubmitOrderRequest')) {
            return false;
        }

        expect($request['account_number'])->toBe($tenant->id)
            ->and($request['subscription_details']['frequency'])->toBe('MONTHLY')
            ->and($request['subscription_details']['start_date'])->toMatch('/^\d{2}-\d{2}-\d{4}$/')
            ->and($request['subscription_details']['end_date'])->toMatch('/^\d{2}-\d{2}-\d{4}$/')
            ->and($request['notification_id'])->toBe(PLATFORM_IPN_ID)
            // MAJOR units on the wire, minor units in the column. A minor unit
            // here is one HUNDREDTH of a shilling, so a conversion wrong by that
            // factor bills a clinic a hundred times its plan — and would pass
            // the fraud boundary, because Pesapal would report back what we
            // asked for.
            ->and($request['amount'])->toBe(250_000);

        return true;
    });

    $charge = PlatformSubscriptionCharge::query()->firstOrFail();

    expect($charge->amount->amountMinor)->toBe(25_000_000)
        ->and($charge->status)->toBe(SubscriptionChargeStatus::Initiated)
        ->and($charge->aggregator_tracking_id)->toBe(PLATFORM_TRACKING_ID);
});

it('tells Pesapal nothing about the clinic beyond the contact details it gave us', function () {
    // The patient path is forbidden from sending anything clinical. Here there
    // is no clinical content to send — and that is the point worth asserting,
    // because a future "richer billing metadata" change would arrive here first.
    billingConfigured();
    billingHttp();

    $tenant = billedClinic();

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertCreated();

    Http::assertSent(function (ClientRequest $request) use ($tenant) {
        if (! str_contains($request->url(), 'SubmitOrderRequest')) {
            return false;
        }

        expect(array_keys((array) $request['billing_address']))->toEqualCanonicalizing([
            'email_address', 'phone_number', 'country_code', 'first_name', 'last_name',
        ]);

        // The description is our reference and nothing else. It lands on a
        // Pesapal receipt and a bank statement, and naming the clinic there
        // tells whoever holds the handset which clinic is a Carevelo customer.
        expect((string) $request['description'])->toStartWith('Carevelo subscription SUB-')
            ->and((string) $request['description'])->not->toContain($tenant->legal_name);

        return true;
    });
});

// --- Rule 6: the platform's own credentials never come back out ----------

it('never returns the platform credentials in any response body, log line or audit event', function () {
    // The same claim H1 makes about a clinic's credentials, made about ours. The
    // asymmetry that makes it worth a separate test: a clinic's credentials
    // leaking exposes one clinic, and the platform's leaking exposes the account
    // every clinic's subscription is collected into.
    billingConfigured();
    billingHttp();

    $tenant = billedClinic();
    $operator = billingOperator();

    $bodies = [];

    $lines = billingCapturedLog(function () use ($tenant, $operator, &$bodies): void {
        $bodies[] = $this->actingAsOperator($operator)
            ->putJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription"), [
                'plan' => 'clinic',
                'price' => 250_000,
            ])
            ->assertOk()
            ->getContent();

        $bodies[] = $this->actingAsOperator($operator)
            ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
            ->assertCreated()
            ->getContent();

        // The read an operator would use to get them back, if anything returned
        // them.
        $bodies[] = $this->actingAsOperator($operator)
            ->getJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription"))
            ->assertOk()
            ->getContent();

        // And the public notification endpoint, which is the one an anonymous
        // caller can actually reach.
        $bodies[] = $this->postJson('/api/webhooks/pesapal-billing', [
            'OrderTrackingId' => PLATFORM_TRACKING_ID,
            'OrderNotificationType' => 'RECURRING',
        ])->getContent();
    });

    $secrets = [PLATFORM_CONSUMER_KEY, PLATFORM_CONSUMER_SECRET, PLATFORM_BEARER_TOKEN];

    foreach ($secrets as $secret) {
        foreach ($bodies as $index => $body) {
            expect(str_contains((string) $body, $secret))->toBeFalse("Response {$index} leaked a platform credential.");
        }

        foreach ($lines as $line) {
            expect(str_contains($line, $secret))->toBeFalse('A platform credential reached the log.');
        }
    }

    // The audit trail is the third place a secret comes to rest, and the one
    // that is retained longest. Platform events carry a null tenant_id, so this
    // reads them with no tenant bound.
    $events = AuditEvent::query()->whereNull('tenant_id')->get();

    expect($events)->not->toBeEmpty('nothing was audited, so this assertion proves nothing');

    foreach ($events as $event) {
        $rendered = $event->action.' '.(json_encode($event->metadata) ?: '');

        foreach ($secrets as $secret) {
            expect(str_contains($rendered, $secret))->toBeFalse('A platform credential reached the audit trail.');
        }
    }
});

// --- The commercial surface itself ---------------------------------------

it('records the plan and the agreed price, and does not collect anything doing it', function () {
    // Recording an agreement and asking Pesapal for money are separate acts, so
    // that a support operator correcting a typo in a price does not thereby
    // charge a clinic. Nothing is faked here, and Http::preventStrayRequests()
    // is what proves no call was attempted.
    billingConfigured();

    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(billingOperator())
        ->putJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription"), [
            'plan' => 'clinic',
            'price' => 250_000,
        ])
        ->assertOk()
        ->assertJsonPath('data.plan', 'clinic')
        // Money is {amount_minor, currency} on the wire, never a bare number.
        ->assertJsonPath('data.price.amount_minor', 25_000_000)
        ->assertJsonPath('data.price.currency', 'UGX');

    expect($tenant->refresh()->plan)->toBe(SubscriptionPlan::Clinic)
        ->and($tenant->plan_price?->amountMinor)->toBe(25_000_000)
        ->and(PlatformSubscriptionCharge::query()->count())->toBe(0);
});

it('refuses a plan a clinic administrator tries to set for itself', function () {
    // There is deliberately no route under /v1/tenant for this. The assertion is
    // that the platform route is not reachable with a clinic session either —
    // a clinic admin setting its own price is the whole of the risk.
    $tenant = billedClinic();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant): User {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    // Plain actingAs, NOT actingAsOperator: this must be refused for lacking the
    // role, and handing it a second-factor stamp would make the assertion about
    // something else.
    $this->actingAs($admin)
        ->putJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription"), [
            'plan' => 'group',
            'price' => 1,
        ])
        ->assertForbidden();

    expect($tenant->refresh()->plan)->toBe(SubscriptionPlan::Clinic);
});

it('refuses a price that is not a whole number of shillings', function () {
    // A float in a money field is the beginning of a rounding defect, and this
    // one would bill a real clinic.
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(billingOperator())
        ->putJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription"), [
            'plan' => 'clinic',
            'price' => 250_000.75,
        ])
        ->assertStatus(422);
});

it('writes no charge at all when the handoff to Pesapal fails', function () {
    // The patient path writes the intent first and lets the reconciliation sweep
    // resolve a failed handoff. THERE IS NO SUCH SWEEP HERE, so a charge written
    // before a handoff that then failed could never be resolved by anything and
    // would sit in the operator's console for ever looking like a collection in
    // progress.
    billingConfigured();

    Http::fake([
        '*/api/Auth/RequestToken' => Http::response(['token' => PLATFORM_BEARER_TOKEN]),
        '*/api/Transactions/SubmitOrderRequest' => Http::response(['error' => ['code' => 'invalid_request']]),
    ]);

    $tenant = billedClinic();

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertStatus(503);

    expect(PlatformSubscriptionCharge::query()->count())->toBe(0);
});

it('refuses to authorise a second recurring collection for the same clinic', function () {
    // A Pesapal recurring mandate is standing permission to take money every
    // month. Two of them means a clinic pays twice a month, for ever, until the
    // CLINIC notices -- which is the worst possible way for this to surface, and
    // a double-clicked button is enough to cause it.
    billingConfigured();
    billingHttp();

    $tenant = billedClinic();
    $operator = billingOperator();

    $this->actingAsOperator($operator)
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertCreated();

    $this->actingAsOperator($operator)
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertStatus(503)
        ->assertJsonPath('code', 'billing_unavailable');

    expect(PlatformSubscriptionCharge::query()->count())->toBe(1);

    // One order submitted, not two. The refusal happens before Pesapal is asked,
    // so a second mandate is never created even momentarily.
    $submitted = 0;

    Http::assertSent(function (ClientRequest $request) use (&$submitted) {
        if (str_contains($request->url(), 'SubmitOrderRequest')) {
            $submitted++;
        }

        return true;
    });

    expect($submitted)->toBe(1);
});

it('refuses to start billing a clinic with no agreed plan', function () {
    // Not a billing failure — a clinic nobody has sold to. Refusing keeps the
    // console honest about which of the two it is looking at.
    billingConfigured();
    billingHttp();

    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(billingOperator())
        ->postJson(billingUrl("/api/v1/platform/tenants/{$tenant->id}/subscription/collect"))
        ->assertStatus(503)
        ->assertJsonPath('code', 'billing_unavailable');

    Http::assertNothingSent();
});
