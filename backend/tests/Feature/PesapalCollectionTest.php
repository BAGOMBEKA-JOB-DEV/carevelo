<?php

use App\Models\AggregatorAccount;
use App\Models\Appointment;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\FlutterwaveGateway;
use App\Services\Payments\PaymentGateway;
use App\Services\Payments\Pesapal\FakePesapal;
use App\Services\Payments\Pesapal\PesapalGateway;
use App\Tenancy\Tenancy;
use Database\Factories\AggregatorAccountFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| Pesapal — the second aggregator, and the first one we initiate against
|--------------------------------------------------------------------------
|
| ONE PESAPAL MERCHANT ACCOUNT PER CLINIC. That is what keeps ADR-0003 intact
| with a second provider in the tree: the patient pays Pesapal, Pesapal settles
| to the clinic, and Carevelo never holds a shilling. Custody would put us
| inside the NPS Act 2020 PSP and e-money categories at UGX 250m–10bn of
| capital, which would not inconvenience the company — it would end it.
|
| Two substitution points, and the choice between them is deliberate.
|
|   FakePesapal replaces the PORT, for tests about domain behaviour. It is the
|   established pattern here (see ReconciliationTest) and it records which
|   AggregatorAccount every call used, which is how the regulatory claim above
|   becomes an assertion rather than a paragraph.
|
|   Http::fake replaces THE WIRE, for tests about the client itself — token
|   expiry, a non-2xx, a body that cannot be read. Those are properties of the
|   HTTP layer and cannot be proven through a fake that has no HTTP in it.
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
});

/**
 * Deliberately distinctive strings.
 *
 * A substring search for them across every response body, log line and audit
 * event is the whole of the secrets assertion below, so they must not collide
 * with anything the framework emits.
 *
 * @return array<string, string>
 */
function pesapalCredentials(): array
{
    return [
        'provider' => 'pesapal',
        'environment' => 'sandbox',
        'public_key' => 'PESAPALCONSUMERKEY-qq77zz',
        'secret_key' => 'PESAPALCONSUMERSECRET-qq77zz',
        'merchant_reference' => 'MERCH-QQ77ZZ',
    ];
}

const PESAPAL_BEARER_TOKEN = 'pesapal.jwt.qq77zz.bearer';

/**
 * @param  array<string, mixed>  $accountState
 * @return array{Tenant, AggregatorAccount}
 */
function pesapalClinic(array $accountState = []): array
{
    $tenant = Tenant::factory()->create();

    $account = app(Tenancy::class)->run(
        $tenant->id,
        fn (): AggregatorAccount => AggregatorAccountFactory::new()->pesapal()->createOne($accountState),
    );

    return [$tenant, $account];
}

/** @param  array<string, mixed>  $attributes */
function pesapalIntent(Tenant $tenant, array $attributes = []): PaymentIntent
{
    return app(Tenancy::class)->run($tenant->id, fn (): PaymentIntent => PaymentIntent::factory()->create(
        array_merge(['aggregator' => 'pesapal'], $attributes),
    ));
}

/**
 * The account as the database now holds it.
 *
 * Re-read inside tenant context, because row-level security hides the row from
 * a query made outside it -- which is the isolation control working, and a
 * bare refresh() here would fail rather than return another tenant's.
 */
function pesapalReread(Tenant $tenant, AggregatorAccount $account): AggregatorAccount
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): AggregatorAccount => AggregatorAccount::query()->findOrFail($account->id),
    );
}

function pesapalStaff(Tenant $tenant, ClinicalRole $role = ClinicalRole::FrontDesk): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role): User {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

function pesapalUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * The whole Pesapal API, faked at the wire.
 *
 * The bodies are shaped as Pesapal actually sends them, including the two
 * habits that catch people out: a bad credential comes back as HTTP 200 with an
 * `error` object, and GetTransactionStatus reports an INTEGER status code.
 *
 * @param  array<string, mixed>  $overrides
 */
function pesapalHttp(array $overrides = []): void
{
    Http::fake(array_merge([
        '*/api/Auth/RequestToken' => Http::response([
            'token' => PESAPAL_BEARER_TOKEN,
            'expiryDate' => now()->addMinutes(5)->toIso8601String(),
            'error' => null,
            'status' => '200',
        ]),
        '*/api/URLSetup/GetIpnList' => Http::response([]),
        '*/api/URLSetup/RegisterIPN' => Http::response([
            'url' => 'http://carevelo.test/api/webhooks/pesapal/tenant',
            'ipn_id' => 'ipn-guid-0001',
            'error' => null,
            'status' => 200,
        ]),
        '*/api/Transactions/SubmitOrderRequest' => Http::response([
            'order_tracking_id' => 'track-guid-0001',
            'merchant_reference' => 'PAY-2608-0001',
            'redirect_url' => 'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId=track-guid-0001',
            'error' => null,
            'status' => '200',
        ]),
        '*/api/Transactions/GetTransactionStatus*' => Http::response(pesapalStatusBody()),
    ], $overrides));
}

/** @return array<string, mixed> */
function pesapalStatusBody(int $statusCode = 1, int $majorAmount = 30_000): array
{
    return [
        'payment_method' => 'MobileMoney',
        'amount' => $majorAmount,
        'created_date' => now()->toIso8601String(),
        'confirmation_code' => 'PESA-CONF-77',
        'payment_status_description' => 'Completed',
        'description' => 'Carevelo payment PAY-2608-0001',
        'message' => 'Request processed successfully',
        'payment_account' => '256700000001',
        'currency' => 'UGX',
        'status_code' => $statusCode,
        'error' => null,
        'status' => '200',
    ];
}

/**
 * Every log line written while the callback runs.
 *
 * Log::listen sees everything that reaches the logger, so this catches a secret
 * escaping through a debug line, a warning, or an exception trace someone
 * decided to report. Copied from AggregatorAccountTest rather than shared,
 * because a helper two files reach for is a helper one of them will change.
 *
 * @return list<string>
 */
function pesapalCapturedLog(callable $callback): array
{
    $lines = [];

    Log::listen(function (MessageLogged $logged) use (&$lines): void {
        $lines[] = $logged->message.' '.(json_encode($logged->context) ?: '');
    });

    $callback();

    return $lines;
}

// --- Rule 1: the clinic's own credentials, never another tenant's ----------

it('submits the order with the clinic\'s own credentials, never another tenant\'s', function () {
    // ADR-0003 in one assertion. Every collection uses THAT TENANT'S account,
    // there is no platform merchant account to fall back on, and a clinic's
    // patients must never be collected from through a different clinic's
    // Pesapal merchant — which would be that clinic receiving the money.
    [$tenant, $account] = pesapalClinic();
    [, $otherClinicsAccount] = pesapalClinic();

    $frontDesk = pesapalStaff($tenant);

    $fake = new FakePesapal;
    $fake->willHandOff('track-guid-0001');
    app()->instance(PaymentGateway::class, $fake);

    $response = $this->actingAs($frontDesk)
        ->withHeader('Idempotency-Key', (string) Str::uuid())
        ->postJson(pesapalUrl($tenant, '/api/v1/payment-intents'), [
            'payable_type' => 'appointment',
            'payable_id' => (string) Str::ulid(),
            'amount_minor' => 3_000_000,
            'method' => 'mtn_momo',
        ])
        ->assertCreated();

    expect($fake->accountsUsed)->toBe([$account->id])
        ->and($fake->accountsUsed)->not->toContain($otherClinicsAccount->id);

    // The handoff is stored, not merely returned. Pesapal's notification
    // carries the tracking id and nothing else, so an unstored one is a payment
    // that can never be tied back to the attempt it settled.
    $intentId = (string) $response->json('data.id');

    app(Tenancy::class)->run($tenant->id, function () use ($intentId) {
        $intent = PaymentIntent::query()->findOrFail($intentId);

        expect($intent->aggregator)->toBe('pesapal')
            ->and($intent->aggregator_tracking_id)->toBe('track-guid-0001')
            ->and($intent->redirect_url)->toStartWith('https://cybqa.pesapal.com/')
            // Still `initiated`. A redirect URL is somewhere to send the
            // patient, NOT a confirmation that anybody has paid.
            ->and($intent->status)->toBe(PaymentIntentStatus::Initiated);
    });

    // And the patient-facing client is handed somewhere to send them.
    expect($response->json('data.redirect_url'))->toStartWith('https://cybqa.pesapal.com/');
});

it('keeps the clinic working when Pesapal cannot be reached', function () {
    // Payment is a feature; care is not blocked on it. An aggregator outage
    // must not turn a booking into a 5xx — the intent exists, reconciliation
    // will poll it, and the desk falls back to cash at the clinic.
    [$tenant] = pesapalClinic();
    $frontDesk = pesapalStaff($tenant);

    $fake = new FakePesapal;
    $fake->willFail();
    app()->instance(PaymentGateway::class, $fake);

    $this->actingAs($frontDesk)
        ->withHeader('Idempotency-Key', (string) Str::uuid())
        ->postJson(pesapalUrl($tenant, '/api/v1/payment-intents'), [
            'payable_type' => 'appointment',
            'payable_id' => (string) Str::ulid(),
            'amount_minor' => 3_000_000,
            'method' => 'mtn_momo',
        ])
        ->assertCreated()
        ->assertJsonPath('data.redirect_url', null)
        ->assertJsonPath('data.status', 'initiated');
});

it('refuses to invent a Flutterwave initiation', function () {
    // Flutterwave's collection is started by the client against Flutterwave.
    // A stub returning a plausible handoff would send a patient to a page that
    // does not exist, and they would conclude the clinic took their money.
    $tenant = Tenant::factory()->create();

    $account = app(Tenancy::class)->run(
        $tenant->id,
        fn (): AggregatorAccount => AggregatorAccountFactory::new()->createOne(),
    );

    $intent = pesapalIntent($tenant, ['aggregator' => 'flutterwave']);

    expect(fn () => app(FlutterwaveGateway::class)->initiateCollection($account, $intent))
        ->toThrow(AggregatorUnavailable::class, 'initiated by the client');
});

// --- Rule 2: statuses are read, never guessed -----------------------------

it('maps every Pesapal status code, and guesses none of them', function (int|string $code, PaymentIntentStatus $expected) {
    // Pesapal reports an integer, which removes the near-miss vocabulary
    // problem and replaces it with a sharper one: 0 and 1 both look reasonable
    // and mean opposite things.
    [$tenant, $account] = pesapalClinic();
    $intent = pesapalIntent($tenant, ['aggregator_tracking_id' => 'track-guid-0001']);

    pesapalHttp(['*/api/Transactions/GetTransactionStatus*' => Http::response(
        array_merge(pesapalStatusBody(), ['status_code' => $code]),
    )]);

    $reported = app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->fetchStatus($account, $intent),
    );

    expect($reported->status)->toBe($expected);
})->with([
    // 1 COMPLETED. The only code that confirms a booking.
    'completed' => [1, PaymentIntentStatus::Succeeded],
    'failed' => [2, PaymentIntentStatus::Failed],
    'reversed' => [3, PaymentIntentStatus::Reversed],
    // 0 INVALID means Pesapal has nothing for this order — the ordinary state
    // while a patient has the prompt on screen and has not typed a PIN.
    'nothing yet' => [0, PaymentIntentStatus::Pending],
    // Pesapal has sent both a JSON number and a numeric string.
    'completed, as a string' => ['1', PaymentIntentStatus::Succeeded],
]);

it('carries the reported amount for checking, and the confirmation code', function () {
    [$tenant, $account] = pesapalClinic();
    $intent = pesapalIntent($tenant, ['aggregator_tracking_id' => 'track-guid-0001']);

    pesapalHttp();

    $reported = app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->fetchStatus($account, $intent),
    );

    // Major units in, minor units stored. The amount is carried so the resolver
    // can COMPARE it against the intent, never so it can be believed.
    expect($reported->amountMinor)->toBe(3_000_000)
        ->and($reported->aggregatorReference)->toBe('PESA-CONF-77');
});

it('never guesses an unrecognised status code', function (mixed $code) {
    // Pesapal is free to add a fifth code tomorrow without telling us. The
    // failure modes are asymmetric: a code misread as success confirms a
    // booking nobody paid for, so an unknown code is an error and the poll
    // simply happens again.
    [$tenant, $account] = pesapalClinic();
    $intent = pesapalIntent($tenant, ['aggregator_tracking_id' => 'track-guid-0001']);

    pesapalHttp(['*/api/Transactions/GetTransactionStatus*' => Http::response(
        array_merge(pesapalStatusBody(), ['status_code' => $code]),
    )]);

    expect(fn () => app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->fetchStatus($account, $intent),
    ))->toThrow(AggregatorUnavailable::class, 'could not be read');
})->with([
    'a code we have never seen' => 7,
    'a word where a number belongs' => 'completed',
    'a truthy value' => true,
    'nothing at all' => null,
]);

it('refuses a malformed body rather than reading a status out of it', function () {
    [$tenant, $account] = pesapalClinic();
    $intent = pesapalIntent($tenant, ['aggregator_tracking_id' => 'track-guid-0001']);

    pesapalHttp(['*/api/Transactions/GetTransactionStatus*' => Http::response('<html>502 Bad Gateway</html>', 200)]);

    expect(fn () => app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->fetchStatus($account, $intent),
    ))->toThrow(AggregatorUnavailable::class, 'could not be read');
});

it('turns a non-2xx into an unavailable aggregator, carrying no credential', function () {
    [$tenant, $account] = pesapalClinic();
    $intent = pesapalIntent($tenant, ['aggregator_tracking_id' => 'track-guid-0001']);

    pesapalHttp(['*/api/Transactions/GetTransactionStatus*' => Http::response(['error' => 'nope'], 503)]);

    $caught = null;

    try {
        app(Tenancy::class)->run(
            $tenant->id,
            fn () => app(PesapalGateway::class)->fetchStatus($account, $intent),
        );
    } catch (AggregatorUnavailable $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('The aggregator answered 503 and the client did not refuse.');
    expect($caught?->getMessage())->toBe('The aggregator answered with HTTP 503.');

    // NEVER chained. An HTTP client exception carries the request, the request
    // carries the Authorization header, and that header is a clinic's
    // credential — which would then be written to any log that renders the trace.
    expect($caught?->getPrevious())->toBeNull();
});

// --- The token: four minutes against Pesapal's five ------------------------

it('reuses a token within its life, and mints a new one once it is gone', function () {
    // A token that expires mid-request is a failed payment: the patient sees a
    // collection that failed for no reason, at the counter, with a queue behind
    // them. The cache holds it for four minutes against Pesapal's five, and the
    // margin is the point.
    [$tenant, $account] = pesapalClinic();
    $intent = pesapalIntent($tenant, ['aggregator_tracking_id' => 'track-guid-0001']);

    pesapalHttp();

    $read = fn () => app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->fetchStatus($account, $intent),
    );

    $read();
    $this->travel(3)->minutes();
    $read();

    Http::assertSentCount(3);
    expect(pesapalTokenRequests())->toBe(1);

    // Past four minutes from the first mint, and Pesapal's own five is not yet
    // up — which is exactly the window the margin exists to cover.
    $this->travel(2)->minutes();
    $read();

    expect(pesapalTokenRequests())->toBe(2);
});

function pesapalTokenRequests(): int
{
    return Http::recorded(
        fn (ClientRequest $request): bool => str_contains($request->url(), '/api/Auth/RequestToken'),
    )->count();
}

// --- The IPN registration --------------------------------------------------

it('registers the notification URL once, and asks before registering it again', function () {
    // RegisterIPN is not idempotent. A clinic registering on every collection
    // would accumulate registrations and be notified once per registration.
    [$tenant, $account] = pesapalClinic();

    pesapalHttp();

    $intent = pesapalIntent($tenant);

    app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->initiateCollection($account, $intent),
    );

    expect(pesapalReread($tenant, $account)->ipn_id)->toBe('ipn-guid-0001');

    Http::assertSent(fn (ClientRequest $r): bool => str_contains($r->url(), '/api/URLSetup/GetIpnList'));

    // A second collection reuses the stored id and does not register again.
    $second = pesapalIntent($tenant);

    app(Tenancy::class)->run($tenant->id, function () use ($account, $second) {
        $stored = AggregatorAccount::query()->findOrFail($account->id);

        return app(PesapalGateway::class)->initiateCollection($stored, $second);
    });

    $registrations = Http::recorded(
        fn (ClientRequest $r): bool => str_contains($r->url(), '/api/URLSetup/RegisterIPN'),
    )->count();

    expect($registrations)->toBe(1);
});

it('reuses an existing registration rather than creating a duplicate', function () {
    // The column is a cache of Pesapal's own state, not the authority on it. A
    // clinic restored from a backup without it must not end up with two.
    [$tenant, $account] = pesapalClinic();

    $expectedUrl = route('webhooks.pesapal', ['tenant' => $tenant->id]);

    pesapalHttp(['*/api/URLSetup/GetIpnList' => Http::response([
        ['url' => 'https://example.test/old', 'ipn_id' => 'ipn-guid-old'],
        ['url' => $expectedUrl, 'ipn_id' => 'ipn-guid-existing'],
    ])]);

    $intent = pesapalIntent($tenant);

    app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->initiateCollection($account, $intent),
    );

    expect(pesapalReread($tenant, $account)->ipn_id)->toBe('ipn-guid-existing');

    $registrations = Http::recorded(
        fn (ClientRequest $r): bool => str_contains($r->url(), '/api/URLSetup/RegisterIPN'),
    )->count();

    expect($registrations)->toBe(0);
});

// --- What actually goes on the wire ---------------------------------------

it('sends the payer\'s contact, the exact amount, and nothing clinical', function () {
    [$tenant, $account] = pesapalClinic(['ipn_id' => 'ipn-guid-0001']);

    pesapalHttp();

    [$intent, $patient] = app(Tenancy::class)->run($tenant->id, function (): array {
        $patient = Patient::factory()->create([
            'given_name' => 'Nakato',
            'family_name' => 'Mirembe',
            'phone' => '+256772123456',
        ]);

        // A deliberately unmistakable service name. If it appears anywhere in
        // the outbound body, a Pesapal receipt and a mobile-money SMS have just
        // told whoever holds the handset why this person went to a clinic.
        $service = Service::factory()->create(['name' => 'Antiretroviral Therapy Review']);

        $appointment = Appointment::factory()->create([
            'patient_id' => $patient->id,
            'service_id' => $service->id,
        ]);

        return [
            PaymentIntent::factory()->create([
                'aggregator' => 'pesapal',
                'payable_type' => 'appointment',
                'payable_id' => $appointment->id,
                'amount_minor' => 3_000_000,
            ]),
            $patient,
        ];
    });

    app(Tenancy::class)->run(
        $tenant->id,
        fn () => app(PesapalGateway::class)->initiateCollection($account, $intent),
    );

    Http::assertSent(function (ClientRequest $request) use ($intent, $patient): bool {
        if (! str_contains($request->url(), '/api/Transactions/SubmitOrderRequest')) {
            return false;
        }

        $body = $request->data();

        expect($body['id'])->toBe($intent->reference)
            ->and(strlen((string) $body['id']))->toBeLessThanOrEqual(50)
            ->and($body['currency'])->toBe('UGX')
            // THE CONVERSION, on the wire. 3,000,000 minor units is UGX 30,000,
            // and an integer is exact in every JSON decoder that will read it.
            ->and($body['amount'])->toBe(30_000)
            ->and($body['description'])->toBe('Carevelo payment '.$intent->reference)
            ->and(strlen((string) $body['description']))->toBeLessThanOrEqual(100)
            ->and($body['notification_id'])->toBe('ipn-guid-0001')
            ->and($body['billing_address']['phone_number'])->toBe($patient->phone)
            ->and($body['billing_address']['country_code'])->toBe('UG');

        // Nothing clinical leaves with it. Pesapal learns that someone paid a
        // clinic, which it cannot avoid learning, and nothing about why.
        expect(json_encode($body))->not->toContain('Antiretroviral');

        return true;
    });
});

// --- Rule 8: no credential, and no token, anywhere it can be read ---------

it('lets no consumer secret or bearer token reach a response, a log or an audit event', function () {
    // H1 acceptance criterion 3, for the second provider: "Aggregator
    // credentials never appear in any API response, log line or exception
    // trace." Asserted end to end through HTTP rather than by reading a
    // resource class, because the claim is about the wire.
    $tenant = Tenant::factory()->create();
    $admin = pesapalStaff($tenant, ClinicalRole::ClinicAdmin);
    $frontDesk = pesapalStaff($tenant);

    // Pesapal genuinely quotes the consumer key back in some errors. This is
    // the case that would leak one if the client surfaced provider prose.
    pesapalHttp(['*/api/Auth/RequestToken' => Http::response([
        'error' => [
            'error_type' => 'authentication_error',
            'code' => 'invalid_consumer_key_or_secret_provided',
            'message' => 'Invalid consumer key '.pesapalCredentials()['public_key']
                .' or secret '.pesapalCredentials()['secret_key'],
        ],
        'status' => '500',
        'token' => null,
    ])]);

    $bodies = [];

    $lines = pesapalCapturedLog(function () use ($tenant, $admin, $frontDesk, &$bodies): void {
        $bodies[] = $this->actingAs($admin)
            ->putJson(pesapalUrl($tenant, '/api/v1/tenant/aggregator-account'), pesapalCredentials())
            ->assertSuccessful()
            ->getContent();

        // Verification against a credential Pesapal refuses: the path that
        // produces an aggregator error message and puts it in a response.
        $bodies[] = $this->actingAs($admin)
            ->postJson(pesapalUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
            ->assertOk()
            ->getContent();

        $bodies[] = $this->actingAs($frontDesk)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson(pesapalUrl($tenant, '/api/v1/payment-intents'), [
                'payable_type' => 'appointment',
                'payable_id' => (string) Str::ulid(),
                'amount_minor' => 3_000_000,
                'method' => 'mtn_momo',
            ])
            ->assertCreated()
            ->getContent();

        // The read an administrator who typed them would use to get them back.
        $bodies[] = $this->actingAs($admin)
            ->getJson(pesapalUrl($tenant, '/api/v1/tenant/aggregator-account'))
            ->assertOk()
            ->getContent();
    });

    $auditTrail = app(Tenancy::class)->run(
        $tenant->id,
        fn (): string => (string) json_encode(AuditEvent::query()->get()->toArray()),
    );

    $secrets = [
        pesapalCredentials()['public_key'],
        pesapalCredentials()['secret_key'],
        PESAPAL_BEARER_TOKEN,
    ];

    foreach ($secrets as $secret) {
        foreach ($bodies as $index => $body) {
            expect((string) $body)->not->toContain($secret, "Response {$index} leaked a credential.");
        }

        foreach ($lines as $line) {
            expect($line)->not->toContain($secret, 'A credential reached the log.');
        }

        expect($auditTrail)->not->toContain($secret, 'A credential reached the audit trail.');
    }

    // And the verification still told the administrator something they can act
    // on: the machine code, which is short enough that it cannot carry a key.
    expect((string) $bodies[1])->toContain('invalid_consumer_key_or_secret_provided');
});

it('records a Pesapal credential as failing when Pesapal refuses it, and as active when it does not', function () {
    // Verification is a READ. Pesapal's equivalent of Flutterwave's
    // non-existent reference is a token request: it proves the credential and
    // moves no money — there would be no platform account for the shilling to
    // land in if it did.
    $tenant = Tenant::factory()->create();
    $admin = pesapalStaff($tenant, ClinicalRole::ClinicAdmin);

    pesapalHttp();

    $this->actingAs($admin)
        ->putJson(pesapalUrl($tenant, '/api/v1/tenant/aggregator-account'), pesapalCredentials())
        ->assertSuccessful();

    $this->actingAs($admin)
        ->postJson(pesapalUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
        ->assertOk()
        ->assertJsonPath('data.status', 'active')
        ->assertJsonPath('data.provider', 'pesapal');

    // No order was submitted to prove a configuration.
    expect(Http::recorded(
        fn (ClientRequest $r): bool => str_contains($r->url(), 'SubmitOrderRequest'),
    )->count())->toBe(0);
});

it('clears a registered notification id when the credentials are replaced', function () {
    // A registration belongs to the merchant account that made it. Credentials
    // are replaced as a SET, so the new set may be a different Pesapal merchant
    // entirely, and a stale id would point Pesapal at somebody else's URL.
    [$tenant, $account] = pesapalClinic(['ipn_id' => 'ipn-guid-0001']);
    $admin = pesapalStaff($tenant, ClinicalRole::ClinicAdmin);

    $this->actingAs($admin)
        ->putJson(pesapalUrl($tenant, '/api/v1/tenant/aggregator-account'), pesapalCredentials())
        ->assertSuccessful();

    expect(pesapalReread($tenant, $account)->ipn_id)->toBeNull();
});
