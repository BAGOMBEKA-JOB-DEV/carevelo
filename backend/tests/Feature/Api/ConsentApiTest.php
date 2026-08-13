<?php

use App\Http\Controllers\Api\V1\ConsentController;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\ConsentRecord;
use App\Models\Consultation;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Factories\ConsentRecordFactory;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| H2 -- DPPA 2019 consent
|--------------------------------------------------------------------------
|
| "Demonstrable" is the operative word in the statute: months later we must be
| able to reconstruct exactly what a patient was shown and what they said. These
| tests are that claim, checked.
|
| See docs/10-product/prd-h2-patient-registration-consent.md
| See docs/50-security-compliance/data-protection-dppa.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function h2ConsentUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic, a member of its front desk, and a patient awaiting a decision.
 *
 * @param  array<string, mixed>  $patientAttributes
 * @return array{Tenant, User, Patient}
 */
function h2ConsentFixture(array $patientAttributes = []): array
{
    $tenant = Tenant::factory()->create();

    [$staff, $patient] = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $patientAttributes) {
        $staff = User::factory()->create(['tenant_id' => $tenant->id]);
        $staff->assignRole(ClinicalRole::FrontDesk->value);

        return [$staff, Patient::factory()->pendingConsent()->create($patientAttributes)];
    });

    return [$tenant, $staff, $patient];
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function h2Decision(array $overrides = []): array
{
    return array_merge([
        'consent_type' => 'data_processing',
        'affirmed' => true,
        'policy_version' => ConsentController::POLICY_VERSION,
    ], $overrides);
}

// --- The policy itself ------------------------------------------------------

it('publishes the current policy without authentication, in both languages', function () {
    // A patient has to be able to read what they are agreeing to before they
    // have an account, and the text is on the screen rather than behind a link
    // nobody opens.
    [$tenant] = h2ConsentFixture();

    $response = $this->getJson(h2ConsentUrl($tenant, '/api/v1/consent-policies/current'))
        ->assertOk()
        ->assertJsonPath('data.version', ConsentController::POLICY_VERSION)
        ->assertJsonStructure(['data' => ['version', 'text_hash', 'consent_types', 'text' => ['en', 'lg']]]);

    expect($response->json('data.consent_types'))
        ->toBe(['data_processing', 'telemedicine', 'delivery_disclosure'])
        ->and($response->json('data.text.en'))->toContain($tenant->trading_name)
        ->and($response->json('data.text.lg'))->toContain($tenant->trading_name);
});

// --- Granting ---------------------------------------------------------------

it('pins the version and the hash of the exact text that was served', function () {
    // The two halves of the evidence. The version is what we say changed; the
    // hash is what catches the wording edit nobody versioned.
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $policy = $this->getJson(h2ConsentUrl($tenant, '/api/v1/consent-policies/current'))->assertOk();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertCreated()
        ->assertJsonPath('data.action', 'granted')
        ->assertJsonPath('data.policy_version', $policy->json('data.version'))
        ->assertJsonPath('data.policy_text_hash', $policy->json('data.text_hash'));
});

it('activates the patient once data processing is agreed', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertCreated();

    app(Tenancy::class)->run($tenant->id, function () use ($patient) {
        expect($patient->refresh()->status)->toBe(PatientStatus::Active)
            ->and($patient->mayHoldClinicalData())->toBeTrue();
    });
});

it('demands an explicit affirmative action', function () {
    // No pre-ticked box, no default, no "by continuing you agree". The absence
    // of a decision is not a decision.
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), [
            'consent_type' => 'data_processing',
            'policy_version' => ConsentController::POLICY_VERSION,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('affirmed');

    app(Tenancy::class)->run($tenant->id, function () use ($patient) {
        expect(ConsentRecord::query()->where('patient_id', $patient->id)->count())->toBe(0)
            ->and($patient->refresh()->status)->toBe(PatientStatus::PendingConsent);
    });
});

it('refuses to take several consents behind one tick', function () {
    // Consent must be specific. A bundle is not specific, so the wire format
    // does not admit one.
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'consent_type' => ['data_processing', 'telemedicine'],
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('consent_type');
});

it('refuses a decision taken against stale wording', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'policy_version' => '2019-01-01',
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('policy_version');
});

it('will not agree to anything before data processing is agreed', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'consent_type' => 'telemedicine',
        ]))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('does not collect the delivery disclosure at registration', function () {
    // Asking up front for a disclosure that may never happen is not specific
    // consent. It is taken when the patient chooses delivery (H4).
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'consent_type' => 'delivery_disclosure',
        ]))
        ->assertStatus(409);

    // Once the patient is registered and delivery is on the table, it is fine.
    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertCreated();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'consent_type' => 'delivery_disclosure',
        ]))
        ->assertCreated();
});

// --- Minors -----------------------------------------------------------------

it('will not record a minor consenting for themselves', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture([
        'date_of_birth' => now()->subYears(12)->toDateString(),
        'guardian_name' => 'Sarah Nakato',
        'guardian_phone' => '+256772555444',
        'guardian_relationship' => 'mother',
    ]);

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertStatus(422)
        ->assertJsonValidationErrors('granted_by');
});

it('records a guardian as the author of a minor\'s consent', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture([
        'date_of_birth' => now()->subYears(12)->toDateString(),
        'guardian_name' => 'Sarah Nakato',
        'guardian_phone' => '+256772555444',
        'guardian_relationship' => 'mother',
    ]);

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'granted_by' => 'guardian',
            'guardian_name' => 'Sarah Nakato',
            'guardian_relationship' => 'mother',
        ]))
        ->assertCreated()
        ->assertJsonPath('data.granted_by', 'guardian')
        ->assertJsonPath('data.guardian_relationship', 'mother');
});

it('requires the guardian to be named when they are the author', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'granted_by' => 'guardian',
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['guardian_name', 'guardian_relationship']);
});

// --- Declining --------------------------------------------------------------

it('discards the registration when consent is declined, leaving no footprint', function () {
    // The decline path exits BEFORE any clinical data can attach. What survives
    // is the minimal contact detail needed to explain why service could not
    // proceed, and it is purged on schedule.
    [$tenant, $staff, $patient] = h2ConsentFixture([
        'email' => 'aisha@example.com',
        'date_of_birth' => now()->subYears(30)->toDateString(),
        'national_id_number' => 'CM90000000000',
        'address' => 'Plot 4, Ntinda',
        'district' => 'Kampala',
    ]);

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision([
            'affirmed' => false,
        ]))
        ->assertCreated()
        ->assertJsonPath('data.action', 'declined');

    app(Tenancy::class)->run($tenant->id, function () use ($patient) {
        $patient->refresh();

        expect($patient->status)->toBe(PatientStatus::Discarded)
            ->and($patient->mayHoldClinicalData())->toBeFalse()
            ->and($patient->email)->toBeNull()
            ->and($patient->date_of_birth)->toBeNull()
            ->and($patient->national_id_number)->toBeNull()
            ->and($patient->address)->toBeNull()
            ->and(Consultation::query()->where('patient_id', $patient->id)->count())->toBe(0);
    });
});

it('refuses any further decision once a registration is discarded', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision(['affirmed' => false]))
        ->assertCreated();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertStatus(409);
});

// --- Immutability and withdrawal --------------------------------------------

it('cannot be edited once written', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        $patient = Patient::factory()->create();
        $record = ConsentRecordFactory::new()->createOne(['patient_id' => $patient->id]);

        $record->action = 'withdrawn';
        $record->save();
    });
})->throws(LogicException::class, 'immutable');

it('withdraws by writing a new record and never touching the grant', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $grant = $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertCreated();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents/withdraw"), [
            'consent_type' => 'data_processing',
        ])
        ->assertCreated()
        ->assertJsonPath('data.action', 'withdrawn')
        // The withdrawal inherits the version of the grant it revokes: what the
        // patient is walking back is the text they agreed to.
        ->assertJsonPath('data.policy_version', $grant->json('data.policy_version'));

    $grantId = (string) $grant->json('data.id');

    app(Tenancy::class)->run($tenant->id, function () use ($patient, $grantId) {
        expect(ConsentRecord::query()->where('patient_id', $patient->id)->count())->toBe(2)
            ->and(ConsentRecord::query()->findOrFail($grantId)->action)->toBe('granted')
            ->and($patient->refresh()->status)->toBe(PatientStatus::Withdrawn);
    });
});

it('refuses to withdraw a consent that was never granted', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents/withdraw"), [
            'consent_type' => 'telemedicine',
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('returns the whole decision history, superseded records included', function () {
    // The sequence of decisions IS the evidence. A view showing only the
    // current position proves nothing about what came before.
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertCreated();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents/withdraw"), [
            'consent_type' => 'data_processing',
        ])->assertCreated();

    $response = $this->actingAs($staff)
        ->getJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"))
        ->assertOk();

    expect($response->json('data'))->toHaveCount(2)
        ->and(array_column((array) $response->json('data'), 'action'))
        ->toEqualCanonicalizing(['granted', 'withdrawn']);
});

// --- Authorisation and audit ------------------------------------------------

it('refuses to show a consent history to a rider', function () {
    // The denial test. A rider reaches no patient record at all.
    $tenant = Tenant::factory()->create();

    [$rider, $patient] = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $rider = User::factory()->create(['tenant_id' => $tenant->id]);
        $rider->assignRole(ClinicalRole::Rider->value);

        return [$rider, Patient::factory()->create()];
    });

    $this->actingAs($rider)
        ->getJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"))
        ->assertForbidden();
});

it('audits every consent decision with the actor, the tenant and no content', function () {
    [$tenant, $staff, $patient] = h2ConsentFixture();

    $this->actingAs($staff)
        ->postJson(h2ConsentUrl($tenant, "/api/v1/patients/{$patient->id}/consents"), h2Decision())
        ->assertCreated();

    app(Tenancy::class)->run($tenant->id, function () use ($tenant, $staff, $patient) {
        $event = AuditEvent::query()->where('action', 'consent.granted')->firstOrFail();

        expect($event->tenant_id)->toBe($tenant->id)
            ->and($event->getAttribute('actor_id'))->toBe($staff->id)
            ->and($event->metadata)->toMatchArray([
                'patient_id' => $patient->id,
                'consent_type' => 'data_processing',
            ])
            // Identifiers and outcomes only. Never who the patient is.
            ->and($event->metadata)->not->toHaveKeys(['given_name', 'family_name', 'phone', 'email']);
    });
});
