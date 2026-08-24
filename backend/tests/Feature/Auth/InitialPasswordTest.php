<?php

use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Middleware\RequirePasswordChange;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| The password somebody else chose
|--------------------------------------------------------------------------
|
| Clinic staff create patient accounts at the registration desk and read the
| initial password aloud, so for as long as it stands a second person knows it.
| That is a privilege escalation and not a matter of hygiene: the RBAC matrix
| gives consent grant and withdrawal to the `patient` role and to NOBODY else --
| every staff column is a dash. A member of staff who signs in with the
| credential they issued can forge a consent decision, and the audit trail will
| record the actor as the patient, because as far as every layer of the system is
| concerned the patient is who signed in.
|
| So the discharge is enforced rather than advised, and this is where the change
| can break the product instead of protecting it. One wrong route name in the
| allow-list and a patient signs in, can do nothing at all, for ever, with no way
| out. The first test below is the one that catches that, and it is deliberately
| the cheapest and least interesting test in the file.
|
| @see docs/40-api/authentication-and-sessions.md
| @see docs/50-security-compliance/rbac-matrix.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function gateUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A patient account holding a password it did not choose.
 *
 * @return array{Tenant, User}
 */
function gatedPatient(): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => null,
            'password' => 'desk-issued-password',
        ]);
        $user->assignRole(ClinicalRole::Patient->value);
        $user->password_change_required_at = Date::now();
        $user->save();

        Patient::factory()->create(['user_id' => $user->id]);

        return $user;
    });

    return [$tenant, $user];
}

it('names three routes that actually exist', function () {
    // The allow-list is route NAMES, and a name that matches nothing fails open
    // in the worst direction: the route is refused for ever and the only symptom
    // is a patient who cannot use the product. A typo is silent everywhere else.
    foreach (RequirePasswordChange::PERMITTED_ROUTES as $name) {
        expect(Route::has($name))->toBeTrue("RequirePasswordChange allows '{$name}', which is not a registered route.");
    }

    expect(RequirePasswordChange::PERMITTED_ROUTES)->toHaveCount(3);
});

it('refuses an ordinary request while the initial password stands', function () {
    [$tenant, $patient] = gatedPatient();

    $this->actingAs($patient)
        ->getJson(gateUrl($tenant, '/api/v1/appointments'))
        ->assertStatus(403)
        ->assertJsonPath('code', 'password_change_required');
});

it('refuses the consent surface in particular', function () {
    // The escalation this exists to close. Consent grant and withdrawal belong to
    // the patient role alone, so a staff member signing in with the credential
    // they issued is the one actor who can forge a consent decision that the
    // trail attributes to the patient.
    [$tenant, $patient] = gatedPatient();

    $record = app(Tenancy::class)->run($tenant->id, fn () => Patient::query()
        ->where('user_id', $patient->id)
        ->firstOrFail());

    $this->actingAs($patient)
        ->postJson(gateUrl($tenant, '/api/v1/patients/'.$record->id.'/consents'), [
            'consent_type' => 'data_processing',
            'affirmed' => true,
            'policy_version' => ConsentController::POLICY_VERSION,
        ])
        ->assertStatus(403)
        ->assertJsonPath('code', 'password_change_required');
});

it('permits exactly the three routes that lead out of it', function () {
    [$tenant, $patient] = gatedPatient();

    // Who am I -- so a client can explain the password form rather than
    // discovering the refusal one 403 at a time.
    $this->actingAs($patient)
        ->getJson(gateUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('data.password_change_required', true);

    // The way out.
    $this->actingAs($patient)
        ->postJson(gateUrl($tenant, '/api/v1/me/password'), [
            'current_password' => 'desk-issued-password',
            'password' => 'a-password-of-my-own',
            'password_confirmation' => 'a-password-of-my-own',
        ])
        ->assertNoContent();

    // And leaving, which matters most on a shared clinic terminal: a person who
    // cannot proceed must not have to walk away from somebody else's session.
    [$tenant2, $patient2] = gatedPatient();

    $this->actingAs($patient2)
        ->postJson(gateUrl($tenant2, '/api/v1/auth/sign-out'))
        ->assertNoContent();
});

it('opens everything up once the password has been replaced', function () {
    [$tenant, $patient] = gatedPatient();

    $this->actingAs($patient)
        ->postJson(gateUrl($tenant, '/api/v1/me/password'), [
            'current_password' => 'desk-issued-password',
            'password' => 'a-password-of-my-own',
            'password_confirmation' => 'a-password-of-my-own',
        ])
        ->assertNoContent();

    expect($patient->fresh()?->mustChangePassword())->toBeFalse();

    $this->actingAs($patient->fresh())
        ->getJson(gateUrl($tenant, '/api/v1/appointments'))
        ->assertOk();

    $this->actingAs($patient->fresh())
        ->getJson(gateUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('data.password_change_required', false);
});

it('still requires the current password to discharge it', function () {
    // UpdatePasswordRequest is unchanged, deliberately. The patient HAS the
    // current password -- staff read it to them -- so a second, weaker credential
    // path buys nothing and would be a way into every account that had not yet
    // been claimed.
    [$tenant, $patient] = gatedPatient();

    $this->actingAs($patient)
        ->postJson(gateUrl($tenant, '/api/v1/me/password'), [
            'password' => 'a-password-of-my-own',
            'password_confirmation' => 'a-password-of-my-own',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['current_password']);

    expect($patient->fresh()?->mustChangePassword())->toBeTrue();
});

it('does not gate invited staff, who chose their own password', function () {
    // There is nothing for them to discharge, and gating them would be a clinic
    // locked out of its own tenant on the strength of a column nobody set.
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    expect($admin->mustChangePassword())->toBeFalse();

    $this->actingAs($admin)
        ->getJson(gateUrl($tenant, '/api/v1/patients'))
        ->assertOk();
});

it('does not gate a patient who never had a password set for them', function () {
    $tenant = Tenant::factory()->create();

    $patient = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => null]);
        $user->assignRole(ClinicalRole::Patient->value);

        Patient::factory()->create(['user_id' => $user->id]);

        return $user;
    });

    $this->actingAs($patient)
        ->getJson(gateUrl($tenant, '/api/v1/appointments'))
        ->assertOk();
});
