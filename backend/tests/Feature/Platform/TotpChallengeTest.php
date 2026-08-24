<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\TotpRecoveryCode;
use App\Models\User;
use App\Support\Totp\RecoveryCodes;
use App\Support\Totp\Totp;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| The code check: the window, the replay, and the recovery code
|--------------------------------------------------------------------------
|
| Three rules, and each of them is a way a second factor stops being one.
|
| THE WINDOW. RFC 6238 permits a skew allowance and this system's is plus or
| minus one step -- ninety seconds, which is what an unsynchronised device
| actually needs. Widening it reads as harmless and is what every "fix the clock
| drift complaints" patch does: it multiplies the number of live codes at any
| instant and stretches the replay window with them. So step -2 and step +2 are
| refused explicitly, and that refusal is the test, not the acceptance.
|
| THE REPLAY. RFC 6238 § 5.2: the verifier MUST NOT accept a second
| authentication for the same time step. A code is good for ninety seconds, which
| is ninety seconds in which one read off a screen-share, a shoulder or a
| phishing proxy is as good as the operator's own authenticator.
|
| THE RECOVERY CODE. Single use is the property that stops it being a static
| password with extra ceremony -- ten of them, sitting in a drawer, each one a
| standing bypass of the second factor if it could be spent twice.
|
| @see docs/40-api/authentication-and-sessions.md § Second factor
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    /*
     * THE Referer IS LOAD-BEARING AND LOOKS LIKE NOISE.
     *
     * Sanctum starts a session only for a request whose Origin or Referer host
     * matches `config/sanctum.php`'s stateful list -- a browser always sends
     * one, and Laravel's test client never does. Without it
     * `EnsureFrontendRequestsAreStateful` skips StartSession entirely, so
     * `$request->hasSession()` is false, `SecondFactorSession` writes nowhere,
     * and every challenge in this file would be refused as expired.
     *
     * Which would make these tests pass for the wrong reason: a suite asserting
     * that a second factor cannot be completed, on a system where it works.
     * SessionCookieTest found the same trap from the other end.
     */
    $this->withHeader('Referer', sprintf(
        'http://%s/',
        parse_url((string) config('app.url'), PHP_URL_HOST),
    ));
});

function challengeUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/** @return array{User, string} the operator, and the plaintext secret */
function challengeOperator(): array
{
    $secret = Totp::secret();

    $user = User::factory()->create([
        'tenant_id' => null,
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
        'totp_secret_encrypted' => $secret,
        'totp_confirmed_at' => Date::now(),
    ]);

    $user->assignRole(ClinicalRole::PlatformSupport->value);

    return [$user, $secret];
}

function challengeCode(string $secret, int $offset = 0): string
{
    $totp = app(Totp::class);

    return $totp->code($secret, $totp->step(Date::now()->getTimestamp()) + $offset);
}

/**
 * The password step's payload.
 *
 * Returned rather than posted, so the request is made by the test itself: a
 * helper that reached for the test case to post on its behalf would be one more
 * indirection between the assertion and the HTTP call it is about.
 *
 * @return array<string, string>
 */
function challengeCredentials(): array
{
    return [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ];
}

it('refuses a code from outside the permitted skew window', function (int $offset) {
    // Steps -2 and +2 are ARITHMETICALLY CORRECT codes. They are what the
    // operator's authenticator showed a minute ago, or will show a minute from
    // now, and every one of them is refused. A window that accepted them would
    // hold five live codes at every instant instead of three.
    [, $secret] = challengeOperator();

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), [
        'code' => challengeCode($secret, $offset),
    ])->assertStatus(422);

    $this->assertGuest();
})->with([-2, 2, -3, 3]);

it('accepts a code from either edge of the permitted window', function (int $offset) {
    // The control. Without it a check that refused EVERYTHING would satisfy the
    // test above, and an operator whose device is forty seconds out would be
    // locked out of the platform console with no way to tell why.
    [$operator, $secret] = challengeOperator();

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), [
        'code' => challengeCode($secret, $offset),
    ])->assertOk();

    $this->assertAuthenticatedAs($operator);
})->with([-1, 0, 1]);

it('refuses a code a second time inside the window it is still valid in', function () {
    // THE REPLAY TEST. The code below is still live -- it is refused because it
    // has been SPENT, not because it has expired, and the difference is the
    // whole of what `users.totp_last_used_step` exists for. Nothing about the
    // clock changes between the two requests.
    [$operator, $secret] = challengeOperator();

    $code = challengeCode($secret);

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), ['code' => $code])
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-out'))->assertNoContent();

    // Same operator, same password, same code, same time step.
    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), ['code' => $code])
        ->assertStatus(422);

    $this->assertGuest();

    // The refusal reads as a REPLAY in the trail and as an ordinary wrong code
    // on screen. A reviewer needs to know somebody used a code they observed
    // rather than one they generated; the person typing must not be told they
    // hold a real code in the wrong window.
    $outcomes = AuditEvent::query()
        ->where('action', 'totp.challenge_failed')
        ->pluck('metadata')
        ->map(fn (mixed $metadata): mixed => is_array($metadata) ? ($metadata['outcome'] ?? null) : null)
        ->all();

    expect($outcomes)->toContain('replayed');

    expect($operator->fresh()?->totp_last_used_step)->not->toBeNull();
});

it('lets a recovery code work exactly once', function () {
    [$operator] = challengeOperator();

    $codes = app(RecoveryCodes::class)->issue($operator);

    expect($codes)->toHaveCount(RecoveryCodes::COUNT);

    $code = $codes[0];

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), ['recovery_code' => $code])
        ->assertOk();

    $this->assertAuthenticatedAs($operator);

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-out'))->assertNoContent();

    // The SAME code, on the same account, minutes later. A recovery code that
    // could be presented twice is a password that happens to look like a code.
    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), ['recovery_code' => $code])
        ->assertStatus(422);

    $this->assertGuest();

    // Spent, not deleted: a deleted row and a row that never existed look
    // identical to whoever reads this table afterwards, and this is the
    // mechanism by which the second factor is bypassed.
    expect(TotpRecoveryCode::query()->where('user_id', $operator->id)->count())
        ->toBe(RecoveryCodes::COUNT)
        ->and(TotpRecoveryCode::query()->where('user_id', $operator->id)->whereNotNull('used_at')->count())
        ->toBe(1);

    // The audit event for the spend carries the count that remains and nothing
    // that could be used to spend another.
    $spent = AuditEvent::query()->where('action', 'totp.recovery_code_spent')->firstOrFail();

    $metadata = $spent->metadata;

    expect(is_array($metadata) ? $metadata : [])
        ->toHaveKey('recovery_codes_remaining')
        ->and(is_array($metadata) ? $metadata['recovery_codes_remaining'] : null)
        ->toBe(RecoveryCodes::COUNT - 1);

    expect(json_encode($metadata) ?: '')->not->toContain($code);
});

it('refuses a recovery code belonging to a set that was revoked', function () {
    // Re-enrolment revokes the whole set, because codes minted against a secret
    // that has been rotated away must not survive the rotation -- otherwise
    // rotating the authenticator, which is what an operator does when they
    // believe the old one is compromised, leaves ten bypasses in place.
    [$operator] = challengeOperator();

    $old = app(RecoveryCodes::class)->issue($operator);
    app(RecoveryCodes::class)->issue($operator);

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), ['recovery_code' => $old[0]])
        ->assertStatus(422);

    $this->assertGuest();
});

it('refuses a request carrying both a code and a recovery code', function () {
    // A precedence rule on a credential check is a way of choosing which of two
    // comparisons an attacker gets to skip. There is no precedence rule.
    [, $secret] = challengeOperator();

    $this->postJson(challengeUrl('/api/v1/platform/auth/sign-in'), challengeCredentials())
        ->assertOk();

    $this->postJson(challengeUrl('/api/v1/platform/auth/challenge'), [
        'code' => challengeCode($secret),
        'recovery_code' => 'AAAA-BBBB-CCCC-DDDD',
    ])->assertStatus(422);

    $this->assertGuest();
});
