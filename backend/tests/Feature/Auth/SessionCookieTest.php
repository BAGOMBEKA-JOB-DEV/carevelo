<?php

use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Support\Facades\Date;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Symfony\Component\HttpFoundation\Cookie;

/*
|--------------------------------------------------------------------------
| Mandatory test -- a session cookie actually crosses the wire
|--------------------------------------------------------------------------
|
| authentication-and-sessions.md: "All three surfaces use Sanctum cookie sessions --
| HTTP-only, Secure, SameSite. No bearer token is held in local storage, where any
| script with a foothold could read it on a page rendering health data."
|
| None of that was wired up. bootstrap/app.php never called statefulApi(), so the api
| group had no StartSession and no EnsureFrontendRequestsAreStateful: no session
| cookie was ever issued, and `auth:sanctum` fell through to bearer-token
| authentication, found none, and returned 401.
|
| The product was unusable. Signing in returned 200 and then every authenticated
| request failed.
|
| 692 tests passed throughout, including RealSignInFlowTest, which signs in and then
| calls GET /v1/me. It passed because Laravel's test client keeps the session in
| process -- assertAuthenticatedAs inspects the guard, and the follow-up request
| shares the same application instance. Nothing ever asserted that a Set-Cookie
| header existed, so nothing noticed there was no cookie.
|
| This file asserts the transport, not the outcome: the cookie is issued, it is
| HTTP-only, and the flags that protect it are set.
|
| @see docs/40-api/authentication-and-sessions.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function cookieUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/** @return array{Tenant, User} */
function cookiePatient(): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => '+256772900001',
            'phone_verified_at' => Date::now(),
            'password' => 'correct-horse-battery',
        ]);
        $user->assignRole(ClinicalRole::Patient->value);

        return $user;
    });

    return [$tenant, $user];
}

it('issues a session cookie when a password sign-in succeeds', function () {
    // THE test. Not "is the user authenticated" -- the guard can say yes while no
    // cookie was sent, which is exactly what happened. This asks whether the browser
    // was given anything to come back with.
    [$tenant, $user] = cookiePatient();

    // The Referer is not decoration: Sanctum starts a session only for a request whose
    // Origin or Referer matches sanctum.stateful, and a browser always sends one.
    $response = $this->withHeader('Referer', cookieUrl($tenant, '/'))
        ->postJson(cookieUrl($tenant, '/api/v1/auth/sign-in'), [
            'phone' => '0772900001',
            'password' => 'correct-horse-battery',
        ])->assertOk();

    $names = array_map(
        fn (Cookie $cookie) => $cookie->getName(),
        $response->headers->getCookies(),
    );

    // If this fails, the api group is missing statefulApi(): nothing starts or
    // persists a session, and every later request is a 401.
    expect($names)->toContain(config('session.cookie'));

    expect($user->fresh())->not->toBeNull();
});

it('marks the session cookie HTTP-only, so a script cannot read it', function () {
    // The reason a cookie is used instead of a token in local storage: this page
    // renders health data, and any script with a foothold could read a token.
    [$tenant] = cookiePatient();

    $response = $this->withHeader('Referer', cookieUrl($tenant, '/'))
        ->postJson(cookieUrl($tenant, '/api/v1/auth/sign-in'), [
            'phone' => '0772900001',
            'password' => 'correct-horse-battery',
        ])->assertOk();

    $session = null;

    foreach ($response->headers->getCookies() as $cookie) {
        if ($cookie->getName() === config('session.cookie')) {
            $session = $cookie;

            break;
        }
    }

    expect($session)->not->toBeNull()
        ->and($session?->isHttpOnly())->toBeTrue('the session cookie must not be readable by script')
        ->and($session?->getSameSite())->not->toBe('none', 'SameSite=none would allow cross-site submission');
});

it('keeps the api group stateful, which is what makes any of this work', function () {
    // Asserted directly rather than inferred. The middleware being absent is the whole
    // defect, and it is invisible from behaviour inside the test client.
    $middleware = app(Kernel::class);

    // Absent means Sanctum cookie sessions cannot work at all: no session started,
    // no cookie issued, and auth:sanctum falling through to bearer tokens this
    // architecture deliberately does not use.
    expect(app('router')->getMiddlewareGroups()['api'] ?? [])
        ->toContain(EnsureFrontendRequestsAreStateful::class);

    expect($middleware)->not->toBeNull();
});

it('does not authenticate a request carrying no session at all', function () {
    // The other half: the endpoint is genuinely closed, so the test above is measuring
    // something.
    [$tenant] = cookiePatient();

    $this->getJson(cookieUrl($tenant, '/api/v1/me'))->assertUnauthorized();
});
