<?php

use App\Models\OtpCode;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\OtpPurpose;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Hash;

/*
|--------------------------------------------------------------------------
| The proof that the API is reachable
|--------------------------------------------------------------------------
|
| THERE IS NO actingAs() IN THIS FILE, and there must never be. Every other
| test in the suite injects an authenticated user directly into the guard,
| which proves the endpoint behind authentication works and proves nothing
| about authentication itself. For most of this project's life there was no
| way to sign in at all and no test noticed, because no test tried.
|
| This one tries: it asks for a code over HTTP, reads the code out of the
| database the way the handset would read it off a screen, submits it, and then
| calls an endpoint that requires a session. If any link in that chain breaks,
| the product is unusable and this file is the thing that says so.
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

it('signs a patient in end to end with nothing but a phone number and a code', function () {
    $tenancy = app(Tenancy::class);
    $tenant = Tenant::factory()->create();
    $phone = '+256772400100';

    $patient = $tenancy->run($tenant->id, function () use ($tenant, $phone) {
        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'phone' => $phone,
            'phone_verified_at' => null,
        ]);
        $user->assignRole('patient');

        return $user;
    });

    // 1. Ask for a code, over HTTP, as the patient portal would.
    $this->postJson(authUrl($tenant, '/api/v1/auth/otp/request'), ['phone' => '0772 400 100'])
        ->assertStatus(202);

    // 2. Read the code. The handset reads it off a lock screen; the test reads
    //    it from the row, because the row is the only other place it exists --
    //    and it exists there only as a digest, so the plaintext is recovered by
    //    the one method available to anyone: guessing against the digest.
    $code = $tenancy->run($tenant->id, function () use ($phone) {
        $record = OtpCode::query()
            ->where('phone', $phone)
            ->where('purpose', OtpPurpose::SignIn->value)
            ->latest()
            ->firstOrFail();

        for ($candidate = 0; $candidate <= 999999; $candidate++) {
            $attempt = str_pad((string) $candidate, OtpCode::LENGTH, '0', STR_PAD_LEFT);

            if (Hash::check($attempt, $record->code_hash)) {
                return $attempt;
            }
        }

        return null;
    });

    expect($code)->not->toBeNull();

    // 3. Submit it. A session comes back, bound to this clinic.
    $signIn = $this->postJson(authUrl($tenant, '/api/v1/auth/otp/verify'), [
        'phone' => '0772 400 100',
        'code' => $code,
    ])->assertOk();

    expect($signIn->json('id'))->toBe($patient->id);
    $this->assertAuthenticatedAs($patient);

    // 4. And the session reaches an authenticated endpoint.
    $this->getJson(authUrl($tenant, '/api/v1/me'))
        ->assertOk()
        ->assertJsonPath('id', $patient->id)
        ->assertJsonMissingPath('password');
})->skip(
    fn () => false,
    'Brute-forcing the digest is the only way to recover a code without a fake gateway.'
);
