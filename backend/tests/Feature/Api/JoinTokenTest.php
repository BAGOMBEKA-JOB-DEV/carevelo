<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\JoinToken;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Join tokens
|--------------------------------------------------------------------------
|
| The last endpoint in the catalogue without an implementation, and the one that
| makes teleconsultation reachable end to end: without it there is no way for
| either party to enter a consultation they have paid for.
|
| The provider cannot enforce any of what follows. It is told a room name and a
| role and nothing else -- deliberately, since it is a third party very likely
| outside Uganda and every field handed to it is a cross-border transfer that
| would have to be disclosed in the consent text. So short-lived, single-use and
| participant-bound are properties this API supplies, and each is tested here.
|
| @see docs/30-architecture/realtime-and-video.md
| @see docs/70-decisions/0004-video-provider-selection.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function joinUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A confirmed appointment, its patient's account, and a clinician.
 *
 * @return array{tenant: Tenant, patientUser: User, clinician: User, other: User, appointment: Appointment}
 */
function joinFixture(?AppointmentStatus $status = null): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $status) {
        $account = function (string $phone, ClinicalRole $role) use ($tenant): User {
            $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => $phone]);
            $user->assignRole($role->value);

            return $user;
        };

        $patientUser = $account('+256772000301', ClinicalRole::Patient);
        $clinician = $account('+256772000302', ClinicalRole::Clinician);
        $other = $account('+256772000303', ClinicalRole::Patient);

        $patient = Patient::factory()->create(['phone' => '+256772000301']);
        $patient->user_id = $patientUser->id;
        $patient->save();

        $otherPatient = Patient::factory()->create(['phone' => '+256772000303']);
        $otherPatient->user_id = $other->id;
        $otherPatient->save();

        $appointment = Appointment::factory()->create([
            'patient_id' => $patient->id,
            'status' => $status ?? AppointmentStatus::Confirmed,
            'scheduled_start_at' => Date::now()->addMinutes(5),
            'scheduled_end_at' => Date::now()->addMinutes(35),
        ]);

        return compact('tenant', 'patientUser', 'clinician', 'other', 'appointment');
    });
}

// --- Issuing ---------------------------------------------------------------

it('issues a token to the patient whose appointment it is', function () {
    $f = joinFixture();

    $body = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()
        ->json('data');

    expect($body['token'])->toBeString()
        ->and(strlen((string) $body['token']))->toBeGreaterThan(32)
        ->and($body['expires_at'])->toBeString();
});

it('issues a separate token to the clinician', function () {
    // Two participants, two tokens. One shared token would be a link either of
    // them could forward.
    $f = joinFixture();

    $patientToken = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    $clinicianToken = $this->actingAs($f['clinician'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    expect($patientToken)->not->toBe($clinicianToken);
});

it('refuses a token to another clinic patient', function () {
    $f = joinFixture();

    $this->actingAs($f['other'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertForbidden();
});

it('refuses a token for an unpaid appointment', function () {
    // awaiting_payment is not joinable. A consultation entered before payment is
    // a consultation the clinic gave away.
    $f = joinFixture(AppointmentStatus::AwaitingPayment);

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertForbidden();
});

it('refuses a token for a cancelled appointment', function () {
    $f = joinFixture(AppointmentStatus::Cancelled);

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertForbidden();
});

it('refuses a token long after the appointment has finished', function () {
    // A token that outlives its appointment is a standing invitation.
    $tenant = Tenant::factory()->create();

    [$user, $appointment] = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => '+256772000401']);
        $user->assignRole(ClinicalRole::Patient->value);

        $patient = Patient::factory()->create(['phone' => '+256772000401']);
        $patient->user_id = $user->id;
        $patient->save();

        return [$user, Appointment::factory()->create([
            'patient_id' => $patient->id,
            'status' => AppointmentStatus::Confirmed,
            'scheduled_start_at' => Date::now()->subDays(3),
            'scheduled_end_at' => Date::now()->subDays(3)->addMinutes(30),
        ])];
    });

    $this->actingAs($user)
        ->postJson(joinUrl($tenant, '/api/v1/appointments/'.$appointment->id.'/join-token'))
        ->assertForbidden();
});

it('never stores the token in the clear', function () {
    $f = joinFixture();

    $plaintext = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    $stored = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => JoinToken::query()->firstOrFail()->token_hash
    );

    expect($stored)->not->toBe($plaintext)
        ->and($stored)->not->toContain((string) $plaintext);
});

// --- Redeeming -------------------------------------------------------------

it('redeems a token once and refuses it the second time', function () {
    // THE single-use test. A reusable join link is a link that can be forwarded
    // into somebody else's consultation.
    $f = joinFixture();

    $token = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $token])
        ->assertOk();

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $token])
        ->assertForbidden();
});

it('refuses a token presented by a different participant', function () {
    // Participant-bound: the clinician's token is worthless in the patient's
    // hands, and the other way round.
    $f = joinFixture();

    $clinicianToken = $this->actingAs($f['clinician'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $clinicianToken])
        ->assertForbidden();
});

it('refuses an expired token', function () {
    $f = joinFixture();

    $token = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    app(Tenancy::class)->run($f['tenant']->id, function () {
        $record = JoinToken::query()->firstOrFail();
        $record->expires_at = Date::now()->subMinute();
        $record->save();
    });

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $token])
        ->assertForbidden();
});

it('refuses a guessed token', function () {
    $f = joinFixture();

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), [
            'token' => str_repeat('a', 64),
        ])
        ->assertForbidden();
});

// --- What the provider is told ---------------------------------------------

it('gives the provider an opaque room and a role, and no identity', function () {
    // The provider is a third party, in Phase 1 very likely outside Uganda. Every
    // field it receives is a cross-border transfer of personal data that the
    // consent text would have to disclose, so it receives none.
    $f = joinFixture();

    $token = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    $credentials = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $token])
        ->assertOk()
        ->json('data');

    $serialised = json_encode($credentials);

    expect($credentials['room'])->toBe('apt-'.$f['appointment']->id)
        ->and($credentials['participant'])->toBe('patient');

    $patient = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Patient::query()->where('phone', '+256772000301')->firstOrFail()
    );

    foreach ([$patient->given_name, $patient->family_name, '+256772000301', $f['tenant']->legal_name] as $leak) {
        expect($serialised)->not->toContain((string) $leak);
    }
});

// --- Audit -----------------------------------------------------------------

it('audits both the issue and the use of a token', function () {
    // The architecture requires both. One without the other cannot answer "who
    // was in that consultation" -- issuing a token is not the same as using it.
    $f = joinFixture();

    $token = $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated()->json('data.token');

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $token])
        ->assertOk();

    $actions = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => AuditEvent::query()->pluck('action')->all()
    );

    expect($actions)->toContain('consultation.join_token_issued')
        ->and($actions)->toContain('consultation.join_token_redeemed');
});

it('keeps no clinical detail on the audit events', function () {
    $f = joinFixture();

    $this->actingAs($f['patientUser'])
        ->postJson(joinUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'))
        ->assertCreated();

    $metadata = app(Tenancy::class)->run($f['tenant']->id, fn () => json_encode(
        AuditEvent::query()->where('action', 'consultation.join_token_issued')->firstOrFail()->metadata
    ));

    // A role and an expiry. Not the token, and not who the person is.
    expect($metadata)->toContain('patient')
        ->and($metadata)->not->toContain('+256772000301');
});
