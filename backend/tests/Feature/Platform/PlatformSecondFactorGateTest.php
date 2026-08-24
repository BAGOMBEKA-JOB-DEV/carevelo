<?php

use App\Http\Middleware\RequireSecondFactor;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Totp\SecondFactorSession;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| A password-only session reaches NOTHING in the platform group
|--------------------------------------------------------------------------
|
| PlatformAuthController opens no session until a code has verified, so in the
| flow as it stands today this middleware refuses nothing -- and that is exactly
| why it has to be tested against a session the flow cannot currently produce.
|
| RequireSecondFactor is the SECOND lock on the same door. It holds if a later
| change ever introduces another way to log a platform account in: an
| impersonation tool, a support "sign in as", a console command, a test helper
| that reaches for actingAs(). Every one of those would satisfy `auth:sanctum`
| and would still have to get past this.
|
| So this file deliberately does the thing the rest of the suite is told not to
| do -- it injects a session with actingAs() and no verification stamp -- because
| that IS the threat being modelled. If the gate is ever removed from the group,
| these tests go green on a control plane reachable with one factor, which is why
| the routes are DISCOVERED FROM THE ROUTER rather than listed: a new platform
| endpoint added next month is covered by this file the day it is written.
|
| @see docs/40-api/authentication-and-sessions.md § Acceptance criteria, item 5
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

function secondFactorGateUrl(string $path): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function secondFactorGateOperator(): User
{
    $user = User::factory()->create([
        'tenant_id' => null,
        'email' => 'gate@carevelo.test',
        'totp_secret_encrypted' => 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        'totp_confirmed_at' => Date::now(),
    ]);

    $user->assignRole(ClinicalRole::PlatformAdmin->value);

    return $user;
}

/**
 * Every route in the platform group that a session is supposed to have to pass
 * the gate for.
 *
 * The three authentication routes are excluded and each for its own reason:
 * `sign-in` and `challenge` carry no session by design -- they are how one is
 * obtained -- and `sign-out` is the single entry on
 * RequireSecondFactor::PERMITTED_ROUTES, because somebody who cannot proceed
 * must still be able to close what they opened.
 *
 * @return list<array{string, string}> method and URI, uppercase method first
 */
function secondFactorGateRoutes(): array
{
    $exempt = array_merge(RequireSecondFactor::PERMITTED_ROUTES, [
        'api.v1.platform.auth.sign-in',
        'api.v1.platform.auth.challenge',
    ]);

    $routes = [];

    // getRoutes() on the collection, rather than iterating the collection
    // itself: RouteCollectionInterface does not promise to be iterable, and the
    // array of Route objects is what this needs.
    foreach (Route::getRoutes()->getRoutes() as $route) {
        $name = $route->getName();

        if ($name === null || ! str_starts_with($name, 'api.v1.platform.')) {
            continue;
        }

        if (in_array($name, $exempt, true)) {
            continue;
        }

        foreach ($route->methods() as $method) {
            if (in_array($method, ['HEAD', 'OPTIONS'], true)) {
                continue;
            }

            $routes[] = [$method, $route->uri()];
        }
    }

    return $routes;
}

it('refuses a password-only session every route in the platform group', function () {
    $operator = secondFactorGateOperator();

    // A real tenant, so a route with a {tenant} parameter gets past route model
    // binding -- which runs BEFORE this middleware -- and is refused by the gate
    // rather than by a 404 that would prove nothing about it.
    $tenant = Tenant::factory()->create();

    $routes = secondFactorGateRoutes();

    // The list is discovered, so an empty one would silently pass. Two routes is
    // the floor at the time of writing; the assertion is that discovery worked.
    expect($routes)->not->toBeEmpty();

    foreach ($routes as [$method, $uri]) {
        $path = '/'.str_replace('{tenant}', $tenant->id, $uri);

        $response = $this->actingAs($operator)
            ->json($method, secondFactorGateUrl($path));

        expect($response->getStatusCode())->toBe(
            403,
            "{$method} {$path} was reachable by a session that passed no second factor",
        );

        expect($response->json('code'))->toBe('second_factor_required', "{$method} {$path}");
    }
});

it('lets a session that passed a second factor through the same gate', function () {
    // The control for the test above. Without it, a middleware that refused
    // EVERYTHING would pass, and a platform console nobody can use is not the
    // outcome being asked for.
    $operator = secondFactorGateOperator();

    $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($operator))
        ->getJson(secondFactorGateUrl('/api/v1/platform/tenants'))
        ->assertOk();
});

it('lets an unverified session sign out, and nothing else', function () {
    // A person who cannot proceed must still be able to leave. On a shared
    // machine the alternative is walking away from a half-open session, and
    // signing out reduces what the session can do rather than extending it.
    $operator = secondFactorGateOperator();

    $this->actingAs($operator)
        ->postJson(secondFactorGateUrl('/api/v1/platform/auth/sign-out'))
        ->assertNoContent();

    $this->assertGuest();
});

it('does not honour a verification stamp issued for a different account', function () {
    // The stamp is bound to a user id, not a bare flag. A flag would still be
    // sitting in the session if the same session later authenticated as somebody
    // else, and would hand that account a factor it never passed.
    $operator = secondFactorGateOperator();

    $somebodyElse = User::factory()->create(['tenant_id' => null, 'email' => 'other@carevelo.test']);
    $somebodyElse->assignRole(ClinicalRole::PlatformAdmin->value);

    $this->actingAs($operator)
        ->withSession(SecondFactorSession::verifiedState($somebodyElse))
        ->getJson(secondFactorGateUrl('/api/v1/platform/tenants'))
        ->assertForbidden()
        ->assertJsonPath('code', 'second_factor_required');
});
