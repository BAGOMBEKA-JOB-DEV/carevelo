<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| The proof that the API is reachable
|--------------------------------------------------------------------------
|
| THERE IS NO actingAs() IN THIS FILE, and there must never be. Every other test
| in the suite injects an authenticated user straight into the guard, which proves
| the endpoint behind authentication works and proves nothing whatsoever about
| authentication itself. For most of this project's life there was no way to sign
| in at all and no test noticed, because no test tried.
|
| THAT RULE NOW COVERS THE STAFF HALF TOO, and it has to. A patient's account is
| created for them by a member of staff at the registration desk, so the journey
| that has to work end to end starts one person earlier than it used to: the front
| desk signs in over HTTP, calls the account endpoint over HTTP, and this file
| reads the initial password out of the 201 body exactly the way a staff member
| reads it off the screen and says it aloud. Mocking that half would leave the
| only path a patient has into the product untested from the outside.
|
| If any link in that chain breaks -- sign-in, the account endpoint, the forced
| password change, the record link, or the session that carries all of it -- the
| product is unusable and this file is what says so.
|
| See docs/40-api/authentication-and-sessions.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
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

/** A member of the clinic's staff who knows their own password. */
function authStaff(Tenant $tenant, ClinicalRole $role, string $email, string $password): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role, $email, $password) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'email' => $email,
            'password' => $password,
        ]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A walk-in registered at the desk: a record, no account, no link.
 *
 * Exactly as it arrives in practice, and exactly what the account endpoint is
 * handed.
 */
function authWalkIn(Tenant $tenant): Patient
{
    return app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());
}

/**
 * The address every patient account below is created against.
 *
 * A constant rather than an argument, because the interesting variable in this
 * file is never the address -- it is the password, which the server chooses and
 * the front desk reads aloud exactly once.
 */
const PATIENT_ADDRESS = 'aisha@example.test';

it('carries a patient from the front desk to their own portal, over HTTP, with no injected session', function () {
    $tenant = Tenant::factory()->create();
    authStaff($tenant, ClinicalRole::FrontDesk, 'desk@kira.test', 'front-desk-password');
    $record = authWalkIn($tenant);

    // 1. The front desk signs in, creates the account, and leaves the terminal.
    //    All three over HTTP: this file's rule covers the staff half too, because
    //    the patient's only way into the product starts one person earlier than it
    //    used to, and mocking that half would leave it untested from the outside.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => 'desk@kira.test',
        'password' => 'front-desk-password',
    ])->assertOk();

    // Read off the screen, the way a staff member reads it out to the patient.
    $initialPassword = (string) $this->postJson(
        authUrl($tenant, '/api/v1/patients/'.$record->id.'/account'),
        ['email' => PATIENT_ADDRESS],
    )->assertCreated()->json('data.initial_password');

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    // 2. The patient, on their own phone, with nothing but what they were told.
    //    No session was injected anywhere above, and none is injected here.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => PATIENT_ADDRESS,
        'password' => $initialPassword,
    ])->assertOk();

    $account = app(Tenancy::class)->run($tenant->id, fn () => User::query()
        ->where('tenant_id', $tenant->id)
        ->whereRaw('lower(email) = ?', [PATIENT_ADDRESS])
        ->firstOrFail());

    $this->assertAuthenticatedAs($account);

    // 3. That session reaches an endpoint behind auth:sanctum, and the response
    //    tells the client why it is about to be refused everything else.
    $this->getJson(authUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('data.id', $account->id)
        ->assertJsonPath('data.password_change_required', true)
        ->assertJsonMissing(['password']);

    // 4. The patient replaces the password somebody else chose, which is the only
    //    thing the account can do until they do it.
    $this->postJson(authUrl($tenant, '/api/v1/me/password'), [
        'current_password' => $initialPassword,
        'password' => 'a-password-of-my-own',
        'password_confirmation' => 'a-password-of-my-own',
    ])->assertNoContent();

    $this->getJson(authUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('data.password_change_required', false);
});

it('reaches the patient\'s own records through the same real session', function () {
    // The other half of "the API is reachable". Signing in proves authentication
    // works; this proves the session then reaches something a patient came for.
    //
    // It also covers the join between the two, which is easy to miss because it is
    // nobody's feature: a record registered by front desk is attached to the
    // account in the same transaction that creates it. The user_id column shipped
    // before anything filled it, and every `P own` endpoint returned an empty list
    // to patients who plainly had records.
    $tenant = Tenant::factory()->create();
    authStaff($tenant, ClinicalRole::FrontDesk, 'desk@kira.test', 'front-desk-password');
    $record = authWalkIn($tenant);

    $appointment = app(Tenancy::class)->run($tenant->id, fn () => Appointment::factory()->create([
        'patient_id' => $record->id,
        'status' => AppointmentStatus::Confirmed,
        'scheduled_start_at' => Date::now()->addMinutes(5),
        'scheduled_end_at' => Date::now()->addMinutes(35),
    ]));

    // The front desk, over HTTP, as above.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => 'desk@kira.test',
        'password' => 'front-desk-password',
    ])->assertOk();

    // Read off the screen, the way a staff member reads it out to the patient.
    $initialPassword = (string) $this->postJson(
        authUrl($tenant, '/api/v1/patients/'.$record->id.'/account'),
        ['email' => PATIENT_ADDRESS],
    )->assertCreated()->json('data.initial_password');

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => PATIENT_ADDRESS,
        'password' => $initialPassword,
    ])->assertOk();

    // THE ORDERING MATTERS AND IT IS NOT COSMETIC. Until the staff-set password is
    // replaced this session reaches nothing at all, so a version of this test that
    // listed appointments first would fail on a 403 that has nothing to do with
    // whether a patient can see their records.
    $this->postJson(authUrl($tenant, '/api/v1/me/password'), [
        'current_password' => $initialPassword,
        'password' => 'a-password-of-my-own',
        'password_confirmation' => 'a-password-of-my-own',
    ])->assertNoContent();

    // Their own appointment, listed to a real session that never saw actingAs().
    $this->getJson(authUrl($tenant, '/api/v1/appointments'))
        ->assertOk()
        ->assertJsonPath('data.0.id', $appointment->id);

    // And through to the consultation itself: issue a token, spend it, get a room.
    $token = $this->postJson(
        authUrl($tenant, '/api/v1/appointments/'.$appointment->id.'/join-token')
    )->assertCreated()->json('data.token');

    $this->postJson(authUrl($tenant, '/api/v1/join-tokens/redeem'), ['token' => $token])
        ->assertOk()
        ->assertJsonPath('data.room', 'apt-'.$appointment->id)
        ->assertJsonPath('data.participant', 'patient');
});

it('refuses everything but the password change until the staff-set password is replaced', function () {
    // The gate, over real HTTP, because this is where the change can break the
    // product rather than protect it: one wrong route name in the allow-list and a
    // patient signs in, can do nothing at all, for ever, with no way out.
    $tenant = Tenant::factory()->create();
    authStaff($tenant, ClinicalRole::FrontDesk, 'desk@kira.test', 'front-desk-password');
    $record = authWalkIn($tenant);

    // The front desk, over HTTP, as above.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => 'desk@kira.test',
        'password' => 'front-desk-password',
    ])->assertOk();

    // Read off the screen, the way a staff member reads it out to the patient.
    $initialPassword = (string) $this->postJson(
        authUrl($tenant, '/api/v1/patients/'.$record->id.'/account'),
        ['email' => PATIENT_ADDRESS],
    )->assertCreated()->json('data.initial_password');

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    // Sign-in itself SUCCEEDS. The session has to exist before the password can be
    // changed; refusing here would hand the patient a credential and no way to
    // spend it.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => PATIENT_ADDRESS,
        'password' => $initialPassword,
    ])->assertOk();

    $this->getJson(authUrl($tenant, '/api/v1/appointments'))
        ->assertStatus(403)
        ->assertJsonPath('code', 'password_change_required');

    $this->getJson(authUrl($tenant, '/api/v1/patients/'.$record->id.'/consents'))
        ->assertStatus(403)
        ->assertJsonPath('code', 'password_change_required');

    // The three that lead out of it.
    $this->getJson(authUrl($tenant, '/api/v1/me'))->assertOk();

    $this->postJson(authUrl($tenant, '/api/v1/me/password'), [
        'current_password' => $initialPassword,
        'password' => 'a-password-of-my-own',
        'password_confirmation' => 'a-password-of-my-own',
    ])->assertNoContent();

    // And the gate is gone for good, on the same session.
    $this->getJson(authUrl($tenant, '/api/v1/appointments'))->assertOk();

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();
    $this->assertGuest();
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
        ->assertJsonPath('data.id', $clinician->id);

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    $this->assertGuest();

    $this->getJson(authUrl($tenant, '/api/v1/me'))->assertUnauthorized();
});

it('refuses the initial password once the patient has changed it', function () {
    // The staff member who created the account still knows what they read aloud.
    // After the change that credential must be worth nothing -- which is the whole
    // reason the change is forced rather than suggested.
    $tenant = Tenant::factory()->create();
    authStaff($tenant, ClinicalRole::FrontDesk, 'desk@kira.test', 'front-desk-password');
    $record = authWalkIn($tenant);

    // The front desk, over HTTP, as above.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => 'desk@kira.test',
        'password' => 'front-desk-password',
    ])->assertOk();

    // Read off the screen, the way a staff member reads it out to the patient.
    $initialPassword = (string) $this->postJson(
        authUrl($tenant, '/api/v1/patients/'.$record->id.'/account'),
        ['email' => PATIENT_ADDRESS],
    )->assertCreated()->json('data.initial_password');

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => PATIENT_ADDRESS,
        'password' => $initialPassword,
    ])->assertOk();

    $this->postJson(authUrl($tenant, '/api/v1/me/password'), [
        'current_password' => $initialPassword,
        'password' => 'a-password-of-my-own',
        'password_confirmation' => 'a-password-of-my-own',
    ])->assertNoContent();

    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    // The password the front desk read out, tried by the front desk.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => PATIENT_ADDRESS,
        'password' => $initialPassword,
    ])->assertStatus(422);

    $this->assertGuest();

    // And the one the patient chose still works.
    $this->postJson(authUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => PATIENT_ADDRESS,
        'password' => 'a-password-of-my-own',
    ])->assertOk();
});
