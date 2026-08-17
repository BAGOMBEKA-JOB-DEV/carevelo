<?php

use App\Models\AggregatorAccount;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Policies\AggregatorAccountPolicy;
use App\Services\Payments\FakeGateway;
use App\Services\Payments\GatewayStatus;
use App\Services\Payments\PaymentGateway;
use App\Tenancy\Tenancy;
use Database\Factories\AggregatorAccountFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| H1 -- the clinic's OWN merchant account
|--------------------------------------------------------------------------
|
| Acceptance criterion 3 of H1: "Aggregator credentials never appear in any API
| response, log line or exception trace. Covered by an automated test." This is
| that test, and it is asserted end to end through HTTP rather than by reading
| the resource class -- a hidden field is one careless `whenLoaded` away from
| being serialised, and the claim being made is about the wire.
|
| Acceptance criterion 5: "A tenant without an aggregator account can complete
| onboarding and hold a consultation." `unconfigured` is a working state.
| Payment is a feature; care is not blocked on it.
|
| See docs/50-security-compliance/payments-regulatory-boundary.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function h1PayUrl(Tenant $tenant, string $path = '/api/v1/tenant/aggregator-account'): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function h1PayStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/** @return array{Tenant, User} */
function h1PayFixture(): array
{
    $tenant = Tenant::factory()->create();

    return [$tenant, h1PayStaff($tenant, ClinicalRole::ClinicAdmin)];
}

/**
 * Deliberately distinctive strings. A substring search for them across every
 * response body and every log line is the whole assertion, so they must not
 * collide with anything the framework emits.
 *
 * @return array<string, string>
 */
function h1PayCredentials(): array
{
    return [
        'provider' => 'flutterwave',
        'environment' => 'sandbox',
        'public_key' => 'FLWPUBK_TEST-publickey-zzq41',
        'secret_key' => 'FLWSECK_TEST-secretkey-zzq41',
        'webhook_secret' => 'whsec_test_webhooksecret_zzq41',
        'merchant_reference' => 'MERCH-ZZQ41',
    ];
}

/** @return list<string> */
function h1PaySecretValues(): array
{
    $credentials = h1PayCredentials();

    return [
        $credentials['public_key'],
        $credentials['secret_key'],
        $credentials['webhook_secret'],
    ];
}

/**
 * Every log line written while the callback runs.
 *
 * Log::listen sees everything that reaches the logger, so this catches a secret
 * escaping through a debug line, a warning, or an exception trace someone
 * decided to report.
 *
 * @return list<string>
 */
function h1PayCapturedLog(callable $callback): array
{
    $lines = [];

    Log::listen(function (MessageLogged $logged) use (&$lines): void {
        $lines[] = $logged->message.' '.(json_encode($logged->context) ?: '');
    });

    $callback();

    return $lines;
}

// --- Write-only credentials ----------------------------------------------

it('never returns a credential it was just given, to anybody', function () {
    [$tenant, $admin] = h1PayFixture();

    $bodies = [];

    $lines = h1PayCapturedLog(function () use ($tenant, $admin, &$bodies): void {
        $gateway = new FakeGateway;
        $gateway->willAlways(GatewayStatus::pending());
        app()->instance(PaymentGateway::class, $gateway);

        $bodies[] = $this->actingAs($admin)
            ->putJson(h1PayUrl($tenant), h1PayCredentials())
            ->assertSuccessful()
            ->getContent();

        $bodies[] = $this->actingAs($admin)
            ->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
            ->assertOk()
            ->getContent();

        // The read the administrator who typed them would use to get them back.
        $bodies[] = $this->actingAs($admin)
            ->getJson(h1PayUrl($tenant))
            ->assertOk()
            ->getContent();
    });

    foreach (h1PaySecretValues() as $secret) {
        foreach ($bodies as $index => $body) {
            expect((string) $body)->not->toContain($secret, "Response {$index} leaked a credential.");
        }

        foreach ($lines as $line) {
            expect($line)->not->toContain($secret, 'A credential reached the log.');
        }
    }
});

it('returns only provider, status, environment and the last verification time', function () {
    [$tenant, $admin] = h1PayFixture();

    $this->actingAs($admin)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertSuccessful();

    $body = $this->actingAs($admin)->getJson(h1PayUrl($tenant))->assertOk()->json('data');

    expect(array_keys($body))->toEqualCanonicalizing([
        'provider', 'status', 'environment', 'last_verified_at',
        'accepts_online_payment', 'fallback', 'credentials_are_write_only',
    ]);

    expect($body['provider'])->toBe('flutterwave');
    expect($body['status'])->toBe('pending_verification');
    expect($body['environment'])->toBe('sandbox');
});

it('creates on the first write and replaces on the next, and re-verification is required either way', function () {
    [$tenant, $admin] = h1PayFixture();

    $this->actingAs($admin)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertCreated();

    $gateway = new FakeGateway;
    $gateway->willAlways(GatewayStatus::pending());
    app()->instance(PaymentGateway::class, $gateway);

    $this->actingAs($admin)
        ->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
        ->assertOk()
        ->assertJsonPath('data.status', 'active');

    // Rotating any part of the credential set drops the account back to
    // unverified. An untested credential claiming to be active is how a clinic
    // discovers at the counter that its key expired last week.
    $this->actingAs($admin)
        ->putJson(h1PayUrl($tenant), [...h1PayCredentials(), 'secret_key' => 'FLWSECK_TEST-rotated-zzq42'])
        ->assertOk()
        ->assertJsonPath('data.status', 'pending_verification')
        ->assertJsonPath('data.accepts_online_payment', false)
        ->assertJsonPath('data.last_verified_at', null);

    expect(app(Tenancy::class)->run($tenant->id, fn () => AggregatorAccount::query()->count()))->toBe(1);
});

it('encrypts the credentials at rest', function () {
    // Envelope encryption, so a leaked database backup does not hand over a
    // clinic's merchant credentials.
    [$tenant, $admin] = h1PayFixture();

    $this->actingAs($admin)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertSuccessful();

    app(Tenancy::class)->run($tenant->id, function () {
        $stored = DB::table('aggregator_accounts')->value('secret_key');

        expect((string) $stored)->not->toContain(h1PayCredentials()['secret_key']);

        // And the application can still use it, which is the point of
        // encrypting rather than hashing.
        expect(AggregatorAccount::query()->first()?->secret_key)
            ->toBe(h1PayCredentials()['secret_key']);
    });
});

it('lets no role read the secrets back', function (ClinicalRole $role) {
    // AggregatorAccountPolicy::viewSecrets() returns false unconditionally.
    // Asserted for every role in the system, including the platform ones, so a
    // future "just for support" exception has to break a test to land.
    [$tenant] = h1PayFixture();

    $user = h1PayStaff($tenant, $role);

    $account = app(Tenancy::class)->run(
        $tenant->id,
        fn () => AggregatorAccountFactory::new()->createOne(),
    );

    expect((new AggregatorAccountPolicy)->viewSecrets($user, $account))->toBeFalse();
})->with(fn () => array_map(fn (ClinicalRole $role) => [$role], ClinicalRole::cases()));

// --- Verification --------------------------------------------------------

it('verifies against the aggregator using the clinic\'s own credentials', function () {
    [$tenant, $admin] = h1PayFixture();

    $gateway = new FakeGateway;
    $gateway->willAlways(GatewayStatus::pending());
    app()->instance(PaymentGateway::class, $gateway);

    $this->actingAs($admin)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertSuccessful();

    $this->actingAs($admin)
        ->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
        ->assertOk()
        ->assertJsonPath('data.status', 'active')
        ->assertJsonPath('data.accepts_online_payment', true);

    $account = app(Tenancy::class)->run($tenant->id, fn () => AggregatorAccount::query()->firstOrFail());

    // The regulatory claim, asserted: this clinic's own account, and no other.
    // There is no platform merchant account to fall back on.
    expect($gateway->accountsUsed)->toBe([$account->id]);
    expect($account->getAttribute('last_verified_at'))->not->toBeNull();
});

it('records a rejected credential as failing and surfaces the aggregator\'s own message', function () {
    [$tenant, $admin] = h1PayFixture();

    $gateway = new FakeGateway;
    $gateway->willFail('The aggregator answered with HTTP 401.');
    app()->instance(PaymentGateway::class, $gateway);

    $this->actingAs($admin)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertSuccessful();

    $this->actingAs($admin)
        ->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
        // Not a 500, and not a blocked onboarding. A refused key is a step to
        // retry; the clinic keeps taking payment at the counter meanwhile.
        ->assertOk()
        ->assertJsonPath('data.status', 'failing')
        ->assertJsonPath('data.accepts_online_payment', false)
        ->assertJsonPath('meta.verification_message', 'The aggregator answered with HTTP 401.');
});

it('does not create a payment attempt in order to verify a credential', function () {
    // Verification is a READ. Charging somebody to prove a configuration would
    // need an account for the shilling to land in, and no such account exists.
    [$tenant, $admin] = h1PayFixture();

    $gateway = new FakeGateway;
    $gateway->willAlways(GatewayStatus::pending());
    app()->instance(PaymentGateway::class, $gateway);

    $this->actingAs($admin)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertSuccessful();
    $this->actingAs($admin)->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))->assertOk();

    expect(app(Tenancy::class)->run($tenant->id, fn () => DB::table('payment_intents')->count()))->toBe(0);
});

it('refuses to verify when there is nothing configured, and says what still works', function () {
    [$tenant, $admin] = h1PayFixture();

    $this->actingAs($admin)
        ->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition')
        ->assertJsonPath('title', fn (?string $title) => str_contains((string) $title, 'pay-at-clinic'));
});

// --- Graceful degradation ------------------------------------------------

it('reports an unconfigured account as a working state rather than a 404', function () {
    // A 404 reads to a console as an error, and a console that treats a missing
    // merchant account as an error is a clinic that stops booking patients.
    [$tenant, $admin] = h1PayFixture();

    $response = $this->actingAs($admin)
        ->getJson(h1PayUrl($tenant))
        ->assertOk()
        ->assertJsonPath('data.status', 'unconfigured')
        ->assertJsonPath('data.provider', null)
        ->assertJsonPath('data.accepts_online_payment', false);

    expect(strtolower((string) $response->json('data.fallback')))->toContain('pay-at-clinic');
});

it('leaves the onboarding checklist completable without a merchant account', function () {
    [$tenant, $admin] = h1PayFixture();

    $items = h1ChecklistByKey(
        $this->actingAs($admin)
            ->getJson(h1PayUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
            ->assertOk()
            ->json('data.items')
    );

    expect($items['aggregator_account']['is_required'])->toBeFalse();
});

// --- Authorisation and input shaping ------------------------------------

it('refuses the aggregator endpoints to every role but the administrator', function (ClinicalRole $role) {
    $tenant = Tenant::factory()->create();
    $staff = h1PayStaff($tenant, $role);

    $this->actingAs($staff)->getJson(h1PayUrl($tenant))->assertForbidden();
    $this->actingAs($staff)->putJson(h1PayUrl($tenant), h1PayCredentials())->assertForbidden();
    $this->actingAs($staff)
        ->postJson(h1PayUrl($tenant, '/api/v1/tenant/aggregator-account/verify'))
        ->assertForbidden();
})->with([
    ClinicalRole::Clinician,
    ClinicalRole::Pharmacist,
    ClinicalRole::FrontDesk,
    ClinicalRole::Dispatcher,
    ClinicalRole::Rider,
]);

it('refuses an unauthenticated request', function () {
    $tenant = Tenant::factory()->create();

    $this->getJson(h1PayUrl($tenant))->assertUnauthorized();
});

it('refuses a payload that is not a full set of the clinic\'s own credentials', function (array $payload) {
    [$tenant, $admin] = h1PayFixture();

    $this->actingAs($admin)
        ->putJson(h1PayUrl($tenant), $payload)
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    expect(app(Tenancy::class)->run($tenant->id, fn () => AggregatorAccount::query()->count()))->toBe(0);
})->with([
    'an unsupported provider' => fn () => [
        ...h1PayCredentials(), 'provider' => 'some-other-processor',
    ],
    'a partial credential rotation' => fn () => [
        'provider' => 'flutterwave', 'environment' => 'sandbox',
        'webhook_secret' => 'whsec_test_only',
    ],
    'an unknown environment' => fn () => [
        ...h1PayCredentials(), 'environment' => 'production',
    ],
    'a field the endpoint does not define' => fn () => [
        ...h1PayCredentials(), 'platform_fee_percent' => 3,
    ],
]);
