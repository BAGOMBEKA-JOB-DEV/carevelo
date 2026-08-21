<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\SessionRegistry;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/*
|--------------------------------------------------------------------------
| Password sign-in, sign-out, password change
|--------------------------------------------------------------------------
|
| The test that matters here is the ENUMERATION test. Everything else on this
| page is ordinary; that one is the reason the endpoint is shaped as it is.
|
| See docs/40-api/authentication-and-sessions.md acceptance criteria 1
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/** The tenant is resolved from the HOST. Never a path, query or body field. */
function sessionUrl(Tenant $tenant, string $path): string
{
    return sprintf(
        'http://%s.%s%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $path,
    );
}

/**
 * @param  array<string, mixed>  $attributes
 * @return array{Tenant, User}
 */
function staffFixture(array $attributes = [], string $role = 'clinician'): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $attributes, $role): User {
        $user = User::factory()->create(array_merge([
            'tenant_id' => $tenant->id,
            'phone' => '+256772500'.fake()->unique()->numerify('###'),
            'password' => 'the-right-password',
        ], $attributes));

        $user->assignRole($role);

        return $user;
    });

    return [$tenant, $user];
}

/** @return array<int, AuditEvent> */
function sessionAudit(Tenant $tenant, string $action): array
{
    return app(Tenancy::class)->run(
        $tenant->id,
        // By id, not occurred_at: identifiers are ULIDs and therefore already in
        // creation order, down to a finer resolution than the timestamp column.
        fn (): array => AuditEvent::query()->where('action', $action)->orderBy('id')->get()->values()->all(),
    );
}

it('signs a member of staff in with a phone number and a password', function () {
    [$tenant, $user] = staffFixture();

    $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        // Written the way a Ugandan writes it. Normalised at the boundary, so
        // this is the same identity as the stored +256... form.
        'phone' => str_replace('+256', '0', (string) $user->phone),
        'password' => 'the-right-password',
    ])
        ->assertOk()
        ->assertJsonPath('data.id', $user->id)
        // A response carrying a password digest is a digest in a browser cache,
        // a proxy log and a screenshot.
        ->assertJsonMissing(['password']);

    $this->assertAuthenticatedAs($user);

    expect(sessionAudit($tenant, 'auth.signed_in'))->toHaveCount(1);
});

it('answers an unregistered number and a wrong password identically', function () {
    // THE enumeration test. In a health application, confirming that a number is
    // registered at a specific clinic discloses that the person is a patient
    // there -- and the clinics on this platform are frequently each other's
    // local competitors.
    [$tenant, $user] = staffFixture();

    $wrongPassword = $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $user->phone,
        'password' => 'not-the-right-password',
    ]);

    $unknownNumber = $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => '+256772999888',
        'password' => 'not-the-right-password',
    ]);

    expect($unknownNumber->status())->toBe($wrongPassword->status())
        ->and($unknownNumber->json())->toBe($wrongPassword->json());

    $wrongPassword->assertStatus(422);
});

it('answers a deactivated account exactly as it answers an unknown one', function () {
    // Even with the correct password. "Your account is disabled" confirms the
    // account exists to whoever now holds the handset.
    [$tenant, $user] = staffFixture(['is_active' => false]);

    $deactivated = $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $user->phone,
        'password' => 'the-right-password',
    ]);

    $unknown = $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => '+256772999777',
        'password' => 'the-right-password',
    ]);

    expect($deactivated->status())->toBe($unknown->status())
        ->and($deactivated->json())->toBe($unknown->json());

    $this->assertGuest();
});

it('records a failed sign-in, and whether the account existed, in the audit trail only', function () {
    // The distinction the response refuses to make is the distinction the clinic
    // needs: a member of staff who forgot a password looks nothing like somebody
    // walking a list of numbers.
    [$tenant, $user] = staffFixture();

    $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $user->phone,
        'password' => 'wrong',
    ])->assertStatus(422);

    $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => '+256772999666',
        'password' => 'wrong',
    ])->assertStatus(422);

    $events = sessionAudit($tenant, 'auth.sign_in_failed');

    expect($events)->toHaveCount(2);

    $existed = array_map(fn (AuditEvent $event): mixed => ((array) $event->metadata)['account_exists'] ?? null, $events);

    expect($existed)->toBe([true, false]);

    // And no phone number in either of them. An audit event records THAT
    // something happened to WHICH record.
    foreach ($events as $event) {
        expect((array) $event->metadata)->not->toHaveKey('phone');
    }
});

it('refuses a user of one clinic on another clinic\'s host', function () {
    // Identity is (tenant_id, phone). The same person at two clinics is two
    // accounts, so these credentials are simply not credentials here.
    [, $user] = staffFixture();
    $otherClinic = Tenant::factory()->create();

    $this->postJson(sessionUrl($otherClinic, '/api/v1/auth/sign-in'), [
        'phone' => (string) $user->phone,
        'password' => 'the-right-password',
    ])->assertStatus(422);

    $this->assertGuest();
});

it('refuses staff sign-in while the clinic is suspended', function () {
    // Suspension is a COMMERCIAL action. Stopping the clinic from working is the
    // point of it.
    [$tenant, $user] = staffFixture();
    $tenant->forceFill(['status' => 'suspended'])->save();

    $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $user->phone,
        'password' => 'the-right-password',
    ])
        ->assertStatus(403)
        ->assertJsonPath('code', 'tenant_suspended');
});

it('still lets a patient in while the clinic is suspended', function () {
    // And must never become a clinical one. A patient reading their own records
    // is no part of a commercial dispute.
    [$tenant, $patient] = staffFixture(role: ClinicalRole::Patient->value);
    $tenant->forceFill(['status' => 'suspended'])->save();

    $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $patient->phone,
        'password' => 'the-right-password',
    ])->assertOk();
});

it('rate limits password attempts for one number', function () {
    [$tenant, $user] = staffFixture();

    foreach (range(1, 10) as $ignored) {
        $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
            'phone' => (string) $user->phone,
            'password' => 'wrong',
        ])->assertStatus(422);
    }

    $this->postJson(sessionUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => (string) $user->phone,
        // The right password, and it still does not get in: the limit counts
        // attempts, not failures.
        'password' => 'the-right-password',
    ])
        ->assertStatus(429)
        ->assertJsonPath('code', 'too_many_attempts')
        ->assertHeader('Retry-After');
});

it('signs out and audits it', function () {
    [$tenant, $user] = staffFixture();

    $this->actingAs($user)
        ->postJson(sessionUrl($tenant, '/api/v1/auth/sign-out'))
        ->assertNoContent();

    $this->assertGuest();

    expect(sessionAudit($tenant, 'auth.signed_out'))->toHaveCount(1);
});

it('changes a password and revokes every other session for that user', function () {
    // The person doing this frequently believes somebody else is signed in as
    // them. A password change that leaves those sessions alive does nothing
    // about the thing that prompted it.
    [$tenant, $user] = staffFixture();

    $otherClinic = Tenant::factory()->create();
    $someoneElse = app(Tenancy::class)->run($otherClinic->id, fn (): User => User::factory()->create([
        'tenant_id' => $otherClinic->id,
        'phone' => '+256772511222',
    ]));

    config(['session.driver' => 'database']);

    DB::table('sessions')->insert([
        ['id' => 'their-phone', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
        ['id' => 'the-front-desk-terminal', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
        ['id' => 'unrelated', 'user_id' => $someoneElse->id, 'payload' => '', 'last_activity' => time()],
    ]);

    $before = $user->getRememberToken();

    $this->actingAs($user)
        ->postJson(sessionUrl($tenant, '/api/v1/me/password'), [
            'current_password' => 'the-right-password',
            'password' => 'a-much-better-password',
            'password_confirmation' => 'a-much-better-password',
        ])
        ->assertNoContent();

    expect(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(0)
        // Somebody else's sessions are nobody else's business.
        ->and(DB::table('sessions')->where('user_id', $someoneElse->id)->count())->toBe(1);

    $user->refresh();

    expect(Hash::check('a-much-better-password', (string) $user->getAuthPassword()))->toBeTrue()
        // The remember-me cookie on a device we cannot reach through the session
        // table dies with the token it was minted from.
        ->and($user->getRememberToken())->not->toBe($before);

    $events = sessionAudit($tenant, 'password.changed');

    expect($events)->toHaveCount(1)
        ->and((array) $events[0]->metadata)->toHaveKey('sessions_revoked')
        // Never the password, and never its digest.
        ->and((array) $events[0]->metadata)->not->toHaveKey('password');
});

it('keeps the session that made the change', function () {
    // Signing somebody out of the request in which they changed their own
    // password is a bug, not a security feature.
    [, $user] = staffFixture();

    config(['session.driver' => 'database']);

    DB::table('sessions')->insert([
        ['id' => 'mine', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
        ['id' => 'theirs', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()],
    ]);

    $revoked = app(SessionRegistry::class)->purgeOtherSessions($user, 'mine');

    expect($revoked)->toBe(1)
        ->and(DB::table('sessions')->where('user_id', $user->id)->pluck('id')->all())->toBe(['mine']);
});

it('refuses a password change without the current password', function () {
    // The one thing a hijacked session does not carry.
    [$tenant, $user] = staffFixture();

    $this->actingAs($user)
        ->postJson(sessionUrl($tenant, '/api/v1/me/password'), [
            'current_password' => 'not-it',
            'password' => 'a-much-better-password',
            'password_confirmation' => 'a-much-better-password',
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    expect(Hash::check('the-right-password', (string) $user->fresh()?->getAuthPassword()))->toBeTrue();
});

it('refuses an unauthenticated password change', function () {
    $tenant = Tenant::factory()->create();

    $this->postJson(sessionUrl($tenant, '/api/v1/me/password'), [
        'current_password' => 'whatever',
        'password' => 'a-much-better-password',
        'password_confirmation' => 'a-much-better-password',
    ])->assertUnauthorized();
});
