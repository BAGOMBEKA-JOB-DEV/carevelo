<?php

use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Signing in with an email address
|--------------------------------------------------------------------------
|
| Either identifier, one code path. An administrator at a desk types an email; a
| clinician between rooms uses the number the clinic already holds. The business plan is
| blunt that "most Ugandan clinic staff have a working phone and no reliably checked email
| address", so neither can be the only way in.
|
| The property that matters most here is the one that is easiest to break by adding a
| second route into the same door: "no account for that address" and "wrong password" must
| stay indistinguishable — in the sentence, the status and the body. A helpful "unknown
| email" would let anyone walk a list of addresses and learn who is a patient or a member
| of staff at a named clinic.
|
| @see docs/40-api/authentication-and-sessions.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function emailUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/** @return array{Tenant, User} */
function emailStaff(string $email = 'sarah@kira.test'): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $email) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'email' => $email,
            'phone' => '+256772500001',
            'phone_verified_at' => Date::now(),
            'password' => 'correct-horse-battery',
        ]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    return [$tenant, $user];
}

it('signs in with an email address and a password', function () {
    [$tenant, $user] = emailStaff();

    $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'email' => 'sarah@kira.test',
            'password' => 'correct-horse-battery',
        ])
        ->assertOk()
        ->assertJsonPath('id', $user->id);

    $this->assertAuthenticatedAs($user);
});

it('accepts the address in any case', function () {
    // Addresses are not case-sensitive in practice, and "Sarah@" failing where "sarah@"
    // works is a support call rather than a security control.
    [$tenant] = emailStaff();

    $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'email' => 'SARAH@Kira.Test',
            'password' => 'correct-horse-battery',
        ])
        ->assertOk();
});

it('still signs in with a phone number, so nothing was traded away', function () {
    [$tenant, $user] = emailStaff();

    $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'phone' => '0772500001',
            'password' => 'correct-horse-battery',
        ])
        ->assertOk()
        ->assertJsonPath('id', $user->id);
});

it('gives a byte-identical answer to an unknown address and a wrong password', function () {
    // THE test. Adding a second way in is the easiest way to open an enumeration hole,
    // so the two responses are compared whole rather than by status alone.
    [$tenant] = emailStaff();

    $unknown = $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'email' => 'nobody@kira.test',
            'password' => 'correct-horse-battery',
        ]);

    $wrongPassword = $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'email' => 'sarah@kira.test',
            'password' => 'not-the-password',
        ]);

    expect($unknown->status())->toBe($wrongPassword->status())
        ->and($unknown->json())->toBe($wrongPassword->json());
});

it('refuses an address belonging to another clinic', function () {
    // The lookup is tenant-scoped, so an address registered next door is not registered
    // here — the same rule phone has always followed.
    [$clinicA] = emailStaff('shared@doctor.test');

    $clinicB = Tenant::factory()->create();

    app(Tenancy::class)->run($clinicB->id, function () use ($clinicB) {
        $user = User::factory()->create([
            'tenant_id' => $clinicB->id,
            'email' => 'shared@doctor.test',
            'password' => 'a-different-password',
        ]);
        $user->assignRole(ClinicalRole::Clinician->value);
    });

    // Clinic A's password must not work on clinic B's host, even though the address is
    // the same person.
    $this->withHeader('Referer', emailUrl($clinicB, '/'))
        ->postJson(emailUrl($clinicB, '/api/v1/auth/sign-in'), [
            'email' => 'shared@doctor.test',
            'password' => 'correct-horse-battery',
        ])
        ->assertStatus(422);

    expect($clinicA->id)->not->toBe($clinicB->id);
});

it('lets one person hold an account at two clinics', function () {
    // What the global unique index on email prevented, contradicting the isolation model
    // and User's own docblock: "someone working at two clinics has two accounts."
    [, $atA] = emailStaff('locum@doctor.test');

    $clinicB = Tenant::factory()->create();

    $atB = app(Tenancy::class)->run($clinicB->id, fn () => User::factory()->create([
        'tenant_id' => $clinicB->id,
        'email' => 'locum@doctor.test',
    ]));

    expect($atA->id)->not->toBe($atB->id)
        ->and($atA->getAttribute('email'))->toBe($atB->getAttribute('email'));
});

it('refuses a request carrying both an email and a phone number', function () {
    // Not a convenience. Two requests that look identical must not sign in as different
    // people depending on which field the server happens to prefer.
    [$tenant] = emailStaff();

    $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'email' => 'sarah@kira.test',
            'phone' => '0772500001',
            'password' => 'correct-horse-battery',
        ])
        ->assertStatus(422);
});

it('refuses a request carrying neither', function () {
    [$tenant] = emailStaff();

    $this->withHeader('Referer', emailUrl($tenant, '/'))
        ->postJson(emailUrl($tenant, '/api/v1/auth/sign-in'), [
            'password' => 'correct-horse-battery',
        ])
        ->assertStatus(422);
});
