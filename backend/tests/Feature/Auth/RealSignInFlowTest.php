<?php

use App\Models\OutboundNotification;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Notifications\TemplateRegistry;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| The proof that the API is reachable
|--------------------------------------------------------------------------
|
| THERE IS NO actingAs() IN THIS FILE, and there must never be. Every other
| test in the suite injects an authenticated user straight into the guard, which
| proves the endpoint behind authentication works and proves nothing whatsoever
| about authentication itself. For most of this project's life there was no way
| to sign in at all and no test noticed, because no test tried.
|
| This one tries. It asks for a code over HTTP, reads the code out of the
| database the way the patient reads it off a lock screen, submits it, and then
| calls an endpoint that requires a session. If any link in that chain breaks,
| the product is unusable and this file is what says so.
|
| See docs/40-api/authentication-and-sessions.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    // The gateway is the notifications module's problem, not authentication's.
    // The row the Notifier writes is what this file reads, and it is written
    // before the job is ever queued.
    Queue::fake();
});

/** The tenant is resolved from the HOST. Never a path, query or body field. */
function authUrl(Tenant $tenant, string $path): string
{
    return sprintf(
        'http://%s.%s%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $path,
    );
}

/**
 * The code as the patient receives it: out of the SMS that was queued.
 *
 * Not out of the otp_codes row, which holds only a digest -- the plaintext
 * exists in the message and nowhere else, which is the property under test as
 * much as it is a convenience here.
 */
function codeFromSms(Tenant $tenant): string
{
    return app(Tenancy::class)->run($tenant->id, function (): string {
        $sms = OutboundNotification::query()
            ->where('template_key', TemplateRegistry::REGISTRATION_OTP)
            ->latest()
            ->firstOrFail();

        preg_match('/\b(\d{6})\b/', $sms->body, $matches);

        // "{code} is your {clinic} verification code..." -- if there is no
        // six-digit group in the body then the template changed, and a test
        // silently reading an empty code would pass for the wrong reason.
        return $matches[1] ?? throw new RuntimeException('No code in the message body.');
    });
}

it('signs a patient in end to end with nothing but a phone number and a code', function () {
    $tenant = Tenant::factory()->create();
    $phone = '+256772400100';

    $patient = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $phone) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => $phone,
            'phone_verified_at' => null,
        ]);
        $user->assignRole('patient');

        return $user;
    });

    // 1. Ask for a code, over HTTP, in the format a Ugandan actually types.
    $this->postJson(authUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772 400 100'])
        ->assertStatus(202)
        ->assertJsonPath('message', 'If that number is registered, a code has been sent by SMS.');

    // 2. Read it off the message.
    $code = codeFromSms($tenant);

    // 3. Submit it. A session comes back, bound to this clinic.
    $this->postJson(authUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772 400 100',
        'code' => $code,
    ])
        ->assertOk()
        ->assertJsonPath('id', $patient->id);

    $this->assertAuthenticatedAs($patient);

    // 4. And that session reaches an endpoint behind auth:sanctum.
    $this->getJson(authUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('id', $patient->id)
        ->assertJsonMissing(['password']);
});

it('signs a clinician in end to end with a password, then out again', function () {
    $tenant = Tenant::factory()->create();

    $clinician = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => '+256772400200',
            'password' => 'correct-horse-battery',
        ]);
        $user->assignRole('clinician');

        return $user;
    });

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => '0772400200',
        'password' => 'correct-horse-battery',
    ])->assertOk();

    $this->assertAuthenticatedAs($clinician);

    $this->getJson(authUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('id', $clinician->id);

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    $this->assertGuest();

    $this->getJson(authUrl($tenant, '/api/v1/me'))->assertUnauthorized();
});

it('refuses the code once it has been spent', function () {
    // The same code, twice. The first request is a sign-in and the second is an
    // attacker with a code out of somebody's message history.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => '+256772400300',
        ])->assignRole('patient');
    });

    $this->postJson(authUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772400300'])
        ->assertStatus(202);

    $code = codeFromSms($tenant);

    $this->postJson(authUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772400300', 'code' => $code,
    ])->assertOk();

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    $this->postJson(authUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772400300', 'code' => $code,
    ])->assertStatus(422);
});
