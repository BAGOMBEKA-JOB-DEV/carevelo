<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Totp\Totp;
use App\Tenancy\Tenancy;
use App\Tenancy\TenantContext;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| A platform operator signs in, and cannot sign in with one factor
|--------------------------------------------------------------------------
|
| docs/40-api/authentication-and-sessions.md, § Acceptance criteria, item 5:
|
|     "Platform operators cannot authenticate without a second factor."
|
| Not "are prompted for", not "are expected to hold" -- CANNOT. This file tests
| that sentence as written, from the outside, over HTTP, with no session injected
| anywhere: the only way a session appears in it is by actually signing in.
|
| The other rule this file exists for is the one that made the endpoint necessary
| at all. A platform account has `tenant_id = null` by definition, so
| `POST /v1/auth/sign-in` cannot serve it -- that route is behind ResolveTenant,
| which reads a tenant from the host, and the controller scopes the lookup to it.
| A platform sign-in therefore RESOLVES NO TENANT AND BINDS NONE, which is
| asserted three ways below: the bare host works where the tenant endpoint 404s,
| no tenant is bound when the request finishes, and every audit event it writes
| lands in the platform trail with a null tenant_id.
|
| @see docs/40-api/authentication-and-sessions.md
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

/** The platform surface resolves no tenant, so it is reached on the bare host. */
function platformSignInUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A Carevelo operator with a known password and, unless told otherwise, a
 * confirmed authenticator.
 *
 * The secret is written straight onto the row because a test that enrolled
 * through the endpoint first would be testing enrolment on its way to testing
 * sign-in, and would fail for two different reasons.
 *
 * @return array{User, string} the operator, and the plaintext secret
 */
function platformSignInOperator(
    string $email = 'ops@carevelo.test',
    string $password = 'a-long-operator-password',
    bool $enrolled = true,
): array {
    $secret = Totp::secret();

    $user = User::factory()->create([
        'tenant_id' => null,
        'email' => $email,
        'password' => $password,
        'totp_secret_encrypted' => $enrolled ? $secret : null,
        'totp_confirmed_at' => $enrolled ? Date::now() : null,
    ]);

    $user->assignRole(ClinicalRole::PlatformSupport->value);

    return [$user, $secret];
}

/** The six digits an authenticator would be showing, `$offset` steps from now. */
function platformSignInCode(string $secret, int $offset = 0): string
{
    $totp = app(Totp::class);

    return $totp->code($secret, $totp->step(Date::now()->getTimestamp()) + $offset);
}

it('refuses to let a platform operator authenticate without a second factor', function () {
    // TESTABLE RULE 5, VERBATIM: "Platform operators cannot authenticate without
    // a second factor."
    //
    // The password is CORRECT here. That is the whole point of the test: the
    // interesting failure is not a wrong password, it is a right one that must
    // still leave the caller holding nothing.
    [, $secret] = platformSignInOperator();

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/sign-in'), [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ])->assertOk()->assertJsonPath('data.second_factor', 'totp');

    // Nobody is signed in. Not narrowed, not restricted -- absent. The password
    // step calls no guard at all, which is what makes the rule true by
    // construction rather than by a list of routes somebody has to maintain.
    $this->assertGuest();

    // And the session it did create reaches nothing: 401, because there is no
    // session to be forbidden.
    $this->getJson(platformSignInUrl('/api/v1/platform/tenants'))->assertUnauthorized();

    expect($secret)->not->toBe('');
});

it('refuses a correct password on an account with no authenticator enrolled', function () {
    // The other half of rule 5, and the one a product usually gets wrong: an
    // operator who has not enrolled yet is signed in "so they can enrol", which
    // is a password-only session on the account that can authorise a break-glass
    // grant into a clinic's records. There is no such session here. Enrolment is
    // out of band -- `php artisan platform:enrol` -- exactly as the specification
    // describes recovery.
    platformSignInOperator(enrolled: false);

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/sign-in'), [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ])
        ->assertForbidden()
        ->assertJsonPath('code', 'second_factor_not_enrolled');

    $this->assertGuest();
});

it('signs an operator in only after the code, and never before it', function () {
    // The happy path, over HTTP, with nothing injected. Without this the two
    // refusals above could both be satisfied by an endpoint that never works.
    [$operator, $secret] = platformSignInOperator();

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/sign-in'), [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ])->assertOk();

    $this->assertGuest();

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/challenge'), [
        'code' => platformSignInCode($secret),
    ])
        ->assertOk()
        ->assertJsonPath('data.email', 'ops@carevelo.test');

    $this->assertAuthenticatedAs($operator);

    // And the session now reaches the control plane it was refused before.
    $this->getJson(platformSignInUrl('/api/v1/platform/tenants'))->assertOk();
});

it('refuses a code with no password behind it', function () {
    // A challenge with no pending state is a caller who skipped the first step,
    // or one whose five minutes ran out. Either way there is nothing to verify
    // against, and the answer is 401 rather than a 422 about the code -- the
    // client has to go back to the password form, not retype six digits.
    [, $secret] = platformSignInOperator();

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/challenge'), [
        'code' => platformSignInCode($secret),
    ])
        ->assertUnauthorized()
        ->assertJsonPath('code', 'challenge_expired');

    $this->assertGuest();
});

it('neither resolves nor binds a tenant when a platform operator signs in', function () {
    // WHY THIS IS A RULE AND NOT AN IMPLEMENTATION DETAIL. Every /v1 route runs
    // behind ResolveTenant so that no handler can query without row-level
    // security scoped to a clinic. A platform account belongs to no clinic, so
    // this surface deliberately runs outside that -- and the thing to prove is
    // that it really is outside it, rather than quietly binding whatever tenant
    // the host happened to suggest.
    [, $secret] = platformSignInOperator();

    // Deliberately created and NOT involved: nothing below may end up bound to
    // it, or to any other clinic.
    Tenant::factory()->create();

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/sign-in'), [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ])->assertOk();

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/challenge'), [
        'code' => platformSignInCode($secret),
    ])->assertOk();

    // 1. No tenant is bound when the request finishes. BindTenantContext would
    //    have set this, and TenantContext is a singleton for the process.
    expect(app(TenantContext::class)->has())->toBeFalse();

    // 2. Every audit event the flow wrote is in the PLATFORM trail. Read with no
    //    tenant bound, which under the audit_events policy returns exactly the
    //    rows whose tenant_id is null -- so a row that had been attributed to a
    //    clinic would be missing from this list rather than merely mislabelled.
    $actions = AuditEvent::query()->pluck('action')->all();

    expect($actions)->toContain('totp.challenge_issued')
        ->and($actions)->toContain('totp.challenge_succeeded')
        ->and($actions)->toContain('auth.signed_in');

    expect(AuditEvent::query()->whereNotNull('tenant_id')->count())->toBe(0);

    // 3. The same request shape against the TENANT sign-in on this host is a
    //    404, because the bare host resolves to no clinic. That is the contrast
    //    that makes the point: the platform endpoint is reachable here precisely
    //    because ResolveTenant is not in front of it.
    $this->postJson(platformSignInUrl('/api/v1/auth/sign-in'), [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ])->assertNotFound();
});

it('does not authenticate a clinic account that shares the address', function () {
    // The single worst outcome available on this endpoint: a clinic's staff
    // account signed in to the cross-tenant control plane because it happened to
    // use the same address. PlatformAccounts scopes every lookup to
    // `tenant_id is null` for this reason, and the refusal is the ordinary
    // enumeration-safe one -- 422 with the same sentence a wrong password gets.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $staff = User::factory()->create([
            'tenant_id' => $tenant->id,
            'email' => 'ops@carevelo.test',
            'password' => 'a-long-operator-password',
        ]);
        $staff->assignRole(ClinicalRole::ClinicAdmin->value);
    });

    $this->postJson(platformSignInUrl('/api/v1/platform/auth/sign-in'), [
        'email' => 'ops@carevelo.test',
        'password' => 'a-long-operator-password',
    ])->assertStatus(422);

    $this->assertGuest();
});
