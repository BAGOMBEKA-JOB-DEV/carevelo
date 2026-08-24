<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\PhoneNumber;
use App\Support\Totp\RecoveryCodes;
use App\Support\Totp\SecondFactorSession;
use App\Support\Totp\Totp;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| Enrolment: what the operator is shown, and what the system keeps
|--------------------------------------------------------------------------
|
| Two rules here, and the first one is the reason this whole surface was
| specified the way it was.
|
| THE LABEL IS AN EMAIL ADDRESS. `otpauth://totp/Carevelo:ops@carevelo.test?...`
| An email address and a password is the whole of how a platform account signs
| in, and the second factor is keyed to an authenticator app the operator holds
| -- never to a mobile number. This product HAD a phone one-time-code sign-in and
| removed it deliberately (2026_08_17_171200_drop_otp_codes_table.php); a second
| factor delivered to, or keyed on, a number is one SIM swap away from being no
| second factor at all, on the account that can authorise a break-glass grant
| into a clinic's patient records.
|
| THE SECRET IS SHOWN ONCE AND KEPT NOWHERE READABLE. It is the factor itself:
| anyone holding it generates the operator's codes for ever. So it appears in one
| HTTP response and never again -- not in a later response, not in an audit
| event, not in a log line, and not in the clear in the database.
|
| @see docs/40-api/authentication-and-sessions.md § Second factor
| @see docs/50-security-compliance/threat-model.md § Spoofing
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

function enrolmentUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * An operator who has already passed a second factor in this session.
 *
 * Which is what both enrolment routes require: they are ROTATION, and an
 * enrolment endpoint reachable with a password alone would be a password-only
 * path to a second factor. First enrolment is `php artisan platform:enrol`.
 */
function enrolmentOperator(string $email = 'ops@carevelo.test'): User
{
    $user = User::factory()->create([
        'tenant_id' => null,
        'email' => $email,
        'totp_secret_encrypted' => Totp::secret(),
        'totp_confirmed_at' => Date::now(),
    ]);

    $user->assignRole(ClinicalRole::PlatformAdmin->value);

    return $user;
}

it('labels the enrolment URI with the operator\'s email address', function () {
    $operator = enrolmentOperator();

    $uri = (string) $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->postJson(enrolmentUrl('/api/v1/platform/totp'))
        ->assertCreated()
        ->json('data.uri');

    // Verbatim. The account label is the address the operator signs in with,
    // and the issuer is the product's name on both sides of the format's
    // deliberate duplication.
    expect($uri)->toStartWith('otpauth://totp/Carevelo:ops@carevelo.test?')
        ->and($uri)->toContain('issuer=Carevelo');

    // The account label, extracted rather than assumed, so a change to the query
    // string cannot make the assertion above pass for the wrong reason.
    $label = rawurldecode((string) parse_url($uri, PHP_URL_PATH));

    expect($label)->toBe('/Carevelo:ops@carevelo.test')
        ->and($label)->toContain((string) $operator->email);

    // AND NO PHONE NUMBER, ANYWHERE. The account below carries one -- the column
    // still exists on users, for clinic staff -- and nothing about this surface
    // may read it.
    $operator->phone = PhoneNumber::parse('+256772900123');
    $operator->save();

    $second = (string) $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->postJson(enrolmentUrl('/api/v1/platform/totp'))
        ->assertCreated()
        ->json('data.uri');

    expect($second)->toContain('ops@carevelo.test')
        ->and($second)->not->toContain('256772900123')
        ->and($second)->not->toContain('+256');
});

it('never lets the secret appear in an audit event, a log line or a later response', function () {
    $operator = enrolmentOperator();

    // Everything the application logs while the enrolment happens. A secret in a
    // log line is a secret in whatever ships those lines off the box, and log
    // retention is not the same conversation as credential retention.
    /** @var list<string> $logged */
    $logged = [];

    Log::listen(function (MessageLogged $message) use (&$logged): void {
        $logged[] = $message->message.' '.(json_encode($message->context) ?: '');
    });

    $enrolment = $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->postJson(enrolmentUrl('/api/v1/platform/totp'))
        ->assertCreated();

    $secret = (string) $enrolment->json('data.secret');
    $uri = (string) $enrolment->json('data.uri');

    expect($secret)->not->toBe('');

    $code = app(Totp::class)->code($secret, app(Totp::class)->step(Date::now()->getTimestamp()));

    $codes = $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->postJson(enrolmentUrl('/api/v1/platform/totp/confirm'), ['code' => $code])
        ->assertOk()
        ->json('data.recovery_codes');

    expect($codes)->toHaveCount(RecoveryCodes::COUNT);

    // 1. NOT IN ANY AUDIT EVENT. The enrolment event records that one happened,
    //    to which account, by what route, and how many codes were issued --
    //    which is the whole of what an auditor needs and the whole of what is
    //    safe to keep permanently.
    $trail = json_encode(AuditEvent::query()->get()->toArray()) ?: '';

    expect($trail)->toContain('totp.enrolled')
        ->and($trail)->not->toContain($secret)
        ->and($trail)->not->toContain($uri)
        ->and($trail)->not->toContain('otpauth://');

    foreach ((array) $codes as $recoveryCode) {
        expect($trail)->not->toContain((string) $recoveryCode);
    }

    // 2. NOT IN A LOG LINE.
    $lines = implode("\n", $logged);

    expect($lines)->not->toContain($secret)
        ->and($lines)->not->toContain('otpauth://');

    // 3. NOT IN ANY LATER RESPONSE. There is no endpoint that reads a stored
    //    secret back, and `me` -- the one endpoint that serialises the account
    //    -- does not carry it. An operator who lost the sheet enrols again.
    $me = $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->getJson(enrolmentUrl('/api/v1/platform/me'))
        ->assertOk();

    expect(json_encode($me->json()) ?: '')->not->toContain($secret);

    /*
     * 4. NOT IN THE CLEAR IN THE DATABASE -- read past the `encrypted` cast,
     *    because a database dump is what this assertion is standing in for.
     *
     *    THE QUERY BUILDER, NOT ELOQUENT, AND THAT IS THE WHOLE POINT OF THE
     *    LINE. `User::query()->value($column)` looks like a raw column read and
     *    is not: Eloquent's Builder::value() is `$this->first([$column])` and
     *    then reads the ATTRIBUTE off the model, so it comes back through the
     *    cast, decrypted. Written that way this test passed the secret to
     *    itself and asserted it did not contain itself -- it could only ever
     *    fail. `DB::table()` touches no model and no cast, so what it returns
     *    is what is actually on disk.
     */
    $stored = (string) DB::table('users')
        ->where('id', $operator->getKey())
        ->value('totp_secret_encrypted');

    expect($stored)->not->toBe('')
        ->and($stored)->not->toContain($secret);

    // And the recovery codes are digests, not codes.
    foreach ((array) $codes as $recoveryCode) {
        expect(json_encode(
            User::query()->whereKey($operator->getKey())->first()?->toArray()
        ) ?: '')->not->toContain((string) $recoveryCode);
    }
});

/**
 * Six digits that are definitely NOT the code this account's authenticator is
 * showing.
 *
 * Not a literal '000000'. One run in a million would find that a literal is the
 * correct code, and a test that fails once a year for a reason nobody can
 * reproduce is worse than no test -- it teaches the team to re-run the suite
 * rather than read it.
 */
function enrolmentWrongCode(User $operator): string
{
    $totp = app(Totp::class);
    $secret = (string) $operator->fresh()?->totp_secret_encrypted;
    $correct = $totp->code($secret, $totp->step(Date::now()->getTimestamp()));

    return $correct === '000000' ? '111111' : '000000';
}

it('refuses to enrol an account that is not a platform account', function () {
    // A clinic administrator legitimately reaches this GROUP -- the break-glass
    // register against their own clinic is theirs to read -- and must not reach
    // these two routes. There is no challenge step in the tenant sign-in, so an
    // enrolment made here would be a secret nothing ever asks for, on an account
    // now marked enrolled: the day RequireSecondFactor is widened to tenant
    // accounts, that administrator is locked out of their own clinic.
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    $this->actingAs($admin)
        ->withSession(SecondFactorSession::verifiedState($admin))
        ->postJson(enrolmentUrl('/api/v1/platform/totp'))
        ->assertForbidden()
        ->assertJsonPath('code', 'not_a_platform_account');
});

it('refuses to confirm an enrolment with a code that does not match', function () {
    $operator = enrolmentOperator();

    $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->postJson(enrolmentUrl('/api/v1/platform/totp'))
        ->assertCreated();

    $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->postJson(enrolmentUrl('/api/v1/platform/totp/confirm'), ['code' => enrolmentWrongCode($operator)])
        ->assertStatus(422);

    // Unconfirmed, so the account still cannot complete a challenge with it. A
    // secret that was generated and never proved against a real authenticator is
    // a secret nobody has.
    expect($operator->fresh()?->totp_confirmed_at)->toBeNull();
});
