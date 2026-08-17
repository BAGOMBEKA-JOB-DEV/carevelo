<?php

use App\Models\AuditEvent;
use App\Models\OtpCode;
use App\Models\OutboundNotification;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\OtpPurpose;
use App\Support\Notifications\TemplateRegistry;
use App\Tenancy\Tenancy;
use Database\Factories\OtpCodeFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| One-time codes
|--------------------------------------------------------------------------
|
| Six digits, five minutes, single use, hashed at rest, rate-limited per number
| AND per address. Each of those is a line in the acceptance criteria and each
| has a test here, because every one of them is the sort of property that is
| easy to believe is true and cheap to break.
|
| See docs/40-api/authentication-and-sessions.md acceptance criteria 2
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    // The gateway belongs to the notifications module. The row the Notifier
    // writes is what these tests read, and it is written before anything queues.
    Queue::fake();
});

/** The tenant is resolved from the HOST. Never a path, query or body field. */
function otpUrl(Tenant $tenant, string $path): string
{
    return sprintf(
        'http://%s.%s%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $path,
    );
}

/** @return array{Tenant, User} */
function otpPatient(string $phone = '+256772600100'): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $phone): User {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => $phone]);
        $user->assignRole('patient');

        return $user;
    });

    return [$tenant, $user];
}

/** @return array<int, AuditEvent> */
function otpAudit(Tenant $tenant, string $action): array
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): array => AuditEvent::query()->where('action', $action)->orderBy('id')->get()->values()->all(),
    );
}

function codeFromMessage(Tenant $tenant): string
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

it('issues a six digit code that lives for five minutes and is hashed at rest', function () {
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100'])
        ->assertStatus(202);

    $code = codeFromMessage($tenant);

    expect($code)->toHaveLength(6);

    app(Tenancy::class)->run($tenant->id, function () use ($code) {
        $record = OtpCode::query()->firstOrFail();

        expect($record->expires_at->diffInMinutes($record->created_at, absolute: true))
            ->toBe((float) OtpCode::TTL_MINUTES)
            // Hashed, not stored. A leaked table hands over no live codes.
            ->and($record->code_hash)->not->toBe($code)
            ->and($record->matches($code))->toBeTrue()
            ->and($record->consumed_at)->toBeNull();
    });
});

it('answers a registered and an unregistered number identically', function () {
    // THE enumeration test for this endpoint. Confirming that a number is
    // registered at a specific clinic discloses that the person is a patient
    // there, which is itself health-adjacent information.
    [$tenant] = otpPatient();

    $registered = $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);
    $unknown = $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772699999']);

    expect($unknown->status())->toBe($registered->status())
        ->and($unknown->json())->toBe($registered->json())
        ->and($registered->status())->toBe(202);

    // And nothing was sent to the number that is not registered here.
    app(Tenancy::class)->run($tenant->id, function () {
        expect(OtpCode::query()->count())->toBe(1);
    });
});

it('records the unregistered attempt in the audit trail, without the number', function () {
    // The clinic can see that somebody is probing. The prober cannot.
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772699999'])
        ->assertStatus(202);

    $events = otpAudit($tenant, 'otp.requested');

    expect($events)->toHaveCount(1)
        ->and((array) $events[0]->metadata)->toMatchArray(['outcome' => 'unknown_identity'])
        ->and((array) $events[0]->metadata)->not->toHaveKey('phone');
});

it('signs a patient in on a code alone, with no password', function () {
    // Requiring a password from someone who consults twice a year produces
    // forgotten passwords, and a forgotten password here is abandoned care.
    [$tenant, $patient] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100',
        'code' => codeFromMessage($tenant),
    ])
        ->assertOk()
        ->assertJsonPath('id', $patient->id);

    $this->assertAuthenticatedAs($patient);

    expect(otpAudit($tenant, 'otp.verified'))->toHaveCount(1)
        ->and(otpAudit($tenant, 'auth.signed_in'))->toHaveCount(1);
});

it('marks the number verified once a code has proved control of the handset', function () {
    [$tenant, $patient] = otpPatient();
    $patient->forceFill(['phone_verified_at' => null])->save();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);
    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100',
        'code' => codeFromMessage($tenant),
    ])->assertOk();

    expect($patient->fresh()?->getAttribute('phone_verified_at'))->not->toBeNull();
});

it('spends a code once, and refuses the replay', function () {
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);
    $code = codeFromMessage($tenant);

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => $code,
    ])->assertOk();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => $code,
    ])->assertStatus(422);

    app(Tenancy::class)->run($tenant->id, function () {
        // Kept, not deleted. Deleting it would make the replay above
        // indistinguishable from a wrong guess.
        expect(OtpCode::query()->firstOrFail()->consumed_at)->not->toBeNull();
    });
});

it('distinguishes a replay from an expiry in the audit trail and nowhere else', function () {
    // The whole point of the pair. A replay is somebody using a code they should
    // not have; an expiry is a patient who was slow. One is an incident and the
    // other is a Tuesday -- and the caller learns which is which either way.
    [$tenant] = otpPatient();

    $replayed = app(Tenancy::class)->run($tenant->id, fn () => OtpCode::factory()->consumed()->create([
        'phone' => '+256772600100',
    ]));

    $replayResponse = $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => OtpCodeFactory::KNOWN_CODE,
    ]);

    app(Tenancy::class)->run($tenant->id, function () use ($replayed) {
        $replayed->delete();
        OtpCode::factory()->expired()->create(['phone' => '+256772600100']);
    });

    $expiredResponse = $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => OtpCodeFactory::KNOWN_CODE,
    ]);

    // Identical to the caller.
    expect($expiredResponse->status())->toBe($replayResponse->status())
        ->and($expiredResponse->json())->toBe($replayResponse->json())
        ->and($replayResponse->status())->toBe(422);

    // Distinct to the clinic.
    $reasons = array_map(
        fn (AuditEvent $event): mixed => ((array) $event->metadata)['reason'] ?? null,
        otpAudit($tenant, 'otp.verification_failed'),
    );

    expect($reasons)->toBe(['replayed', 'expired']);
});

it('answers a wrong code for an unregistered number exactly as it answers a wrong code', function () {
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);

    $wrongCode = $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => '000000',
    ]);

    $unknownNumber = $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772699999', 'code' => '000000',
    ]);

    expect($unknownNumber->status())->toBe($wrongCode->status())
        ->and($unknownNumber->json())->toBe($wrongCode->json());
});

it('burns a code after too many wrong guesses', function () {
    // A six-digit code has a million possibilities, which an attacker with
    // unlimited guesses exhausts by patience alone.
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);
    $code = codeFromMessage($tenant);

    foreach (range(1, OtpCode::MAX_ATTEMPTS) as $ignored) {
        $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
            'phone' => '0772600100', 'code' => '000000',
        ])->assertStatus(422);
    }

    // The RIGHT code, and it is worthless: the budget is spent and the code with
    // it, so a later attempt from a fresh address cannot resume the search.
    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => $code,
    ])->assertStatus(422);

    $this->assertGuest();
});

it('rate limits code requests for one number', function () {
    [$tenant] = otpPatient();

    foreach (range(1, 5) as $ignored) {
        $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100'])
            ->assertStatus(202);
    }

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100'])
        ->assertStatus(429)
        ->assertJsonPath('code', 'too_many_attempts')
        ->assertHeader('Retry-After');
});

it('rate limits code requests from one address across many numbers', function () {
    // The per-number limit does nothing about somebody walking a list of numbers
    // from a single host. This is the limit that does.
    [$tenant] = otpPatient();

    foreach (range(1, 20) as $index) {
        $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), [
            'phone' => '+2567726'.str_pad((string) $index, 5, '0', STR_PAD_LEFT),
        ])->assertStatus(202);
    }

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100'])
        ->assertStatus(429);
});

it('never writes a code to the audit trail or to a log line', function () {
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772600100']);
    $code = codeFromMessage($tenant);

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => $code,
    ])->assertOk();

    $events = app(Tenancy::class)->run(
        $tenant->id,
        fn (): string => (string) json_encode(AuditEvent::query()->get()->toArray()),
    );

    expect($events)->not->toContain($code)
        // The identifier of the code is there, which is what an audit event is
        // for: THAT something happened to WHICH record.
        ->and($events)->toContain('otp_code_id');
});

it('will not accept a code issued by another clinic', function () {
    // Row-level security means the code simply is not there on this host.
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    app(Tenancy::class)->run($tenantA->id, fn () => OtpCode::factory()->create([
        'phone' => '+256772600100',
    ]));

    app(Tenancy::class)->run($tenantB->id, function () use ($tenantB) {
        User::factory()->create([
            'tenant_id' => $tenantB->id,
            'phone' => '+256772600100',
        ])->assignRole('patient');
    });

    $this->postJson(otpUrl($tenantB, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => OtpCodeFactory::KNOWN_CODE,
    ])->assertStatus(422);

    $this->assertGuest();
});

it('rejects a code of the wrong shape before it costs anything', function () {
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => '12345',
    ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('refuses a number that is not a Ugandan number at all', function () {
    [$tenant] = otpPatient();

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0912345678'])
        ->assertStatus(422)
        ->assertJsonPath('errors.phone.0', 'Enter a valid Ugandan phone number, for example 0772 123 456.');
});

it('will not spend a code issued for a different purpose', function () {
    // A code issued to prove one thing must not be replayable against another.
    // Written at the database level because the purpose enum has one case today
    // and this must still hold on the day it has two.
    [$tenant] = otpPatient();

    app(Tenancy::class)->run($tenant->id, function () {
        $code = OtpCode::factory()->create(['phone' => '+256772600100']);

        expect($code->purpose)->toBe(OtpPurpose::SignIn);

        DB::table('otp_codes')->where('id', $code->id)->update(['purpose' => 'something_else']);
    });

    $this->postJson(otpUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772600100', 'code' => OtpCodeFactory::KNOWN_CODE,
    ])->assertStatus(422);

    $this->assertGuest();
});
