<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\PrescriptionStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| E-prescribing over the API -- H3 section 6
|--------------------------------------------------------------------------
|
| The two hard preconditions on prescribing are the flow's central legal point:
| they are what keeps Carevelo a recorder rather than an issuer. Both are
| tested here at the HTTP boundary as well as at the model, because a rule
| enforced only in a unit test is a rule the API can still be talked past.
|
| Data setup and every assertion that touches a row run INSIDE
| Tenancy::run(): outside it, row-level security correctly hides the rows.
|
| See docs/10-product/prd-h3-teleconsultation.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function prescriptionApiUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic with a prescribing clinician and a completed consultation.
 *
 * @param  array<string, mixed>  $clinicianState
 * @return array{Tenant, User, Clinician, Consultation}
 */
function prescriptionFixture(array $clinicianState = [], bool $unsafeForRemoteCare = false): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $clinicianState, $unsafeForRemoteCare) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::Clinician->value);

        $clinician = Clinician::factory()->create(['user_id' => $user->id] + $clinicianState);

        $factory = Consultation::factory();

        if ($unsafeForRemoteCare) {
            $factory = $factory->convertedToInPerson();
        }

        $consultation = $factory->create([
            'clinician_id' => $clinician->id,
            'patient_id' => Patient::factory()->create()->id,
        ]);

        return [$tenant, $user, $clinician, $consultation];
    });
}

/**
 * @return array<string, mixed>
 */
function prescriptionPayload(Consultation $consultation, bool $controlled = false): array
{
    return [
        'consultation_id' => $consultation->id,
        'items' => [[
            'medicine_name' => $controlled ? 'Pethidine' : 'Amoxicillin',
            'form' => $controlled ? 'injection' : 'capsule',
            'strength' => $controlled ? '50mg/ml' : '500mg',
            'quantity' => $controlled ? 2 : 21,
            'unit' => $controlled ? 'ampoule' : 'capsule',
            'directions' => 'As directed by the clinician',
            'is_controlled' => $controlled,
        ]],
    ];
}

// --- Issuing ---------------------------------------------------------------

it('issues a prescription in the clinician\'s own name, never Carevelo\'s', function () {
    // Acceptance criterion 3. The rendered document carries the clinician's
    // snapshotted name, body and registration number; Carevelo appears nowhere
    // as issuer, because it is not one.
    [$tenant, $user, $clinician, $consultation] = prescriptionFixture([
        'registration_number' => 'UMDPC-99999',
    ]);

    $response = $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated()
        ->assertJsonPath('data.status', PrescriptionStatus::Issued->value)
        ->assertJsonPath('data.issued_by.registration_number', 'UMDPC-99999')
        ->assertJsonPath('data.issued_by.registration_body', $clinician->registration_body)
        ->assertJsonPath('data.items.0.medicine_name', 'Amoxicillin');

    expect($response->json('data.issued_by.name'))->toBe($user->name)
        ->and($response->json('data.issued_at'))->not->toBeNull();

    expect(str_contains(strtolower(json_encode($response->json()) ?: ''), 'carevelo'))->toBeFalse('The rendered prescription named Carevelo as issuer');
});

it('refuses to issue a prescription for a clinician without prescribing rights', function () {
    // Hard precondition 1, at the HTTP boundary.
    [$tenant, $user, , $consultation] = prescriptionFixture(['can_prescribe' => false]);

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'illegal_transition')
        ->assertJsonStructure(['type', 'title', 'status', 'code']);

    expect(app(Tenancy::class)->run($tenant->id, fn () => Prescription::query()->count()))->toBe(0);
});

it('refuses to issue a prescription for a clinician with no registration number', function () {
    // Hard precondition 1, other half: can_prescribe alone is not enough.
    [$tenant, $user, , $consultation] = prescriptionFixture(['registration_number' => '']);

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'illegal_transition');
});

it('refuses to issue a prescription when the clinician judged remote care unsafe', function () {
    // Hard precondition 2. Where the clinician referred the patient in person,
    // no prescription follows -- there is no override, and no override is
    // wanted.
    [$tenant, $user, , $consultation] = prescriptionFixture(unsafeForRemoteCare: true);

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'illegal_transition');

    expect(app(Tenancy::class)->run($tenant->id, fn () => Prescription::query()->count()))->toBe(0);
});

it('surfaces a controlled item so the pharmacy knows it needs in-person handling', function () {
    // The flag drives the whole downstream branch: controlled items are
    // excluded from delivery entirely under NDPA Act Cap 206.
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $this->actingAs($user)
        ->postJson(
            prescriptionApiUrl($tenant, '/api/v1/prescriptions'),
            prescriptionPayload($consultation, controlled: true)
        )
        ->assertCreated()
        ->assertJsonPath('data.items.0.is_controlled', true);
});

it('refuses to let anyone but a clinician issue a prescription', function () {
    // Denial, not permission, is what catches privilege escalation. A
    // pharmacist may read a prescription and may never write one.
    [$tenant, , , $consultation] = prescriptionFixture();

    $pharmacist = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::Pharmacist->value);

        return $user;
    });

    // NOTE: no assertion on the problem+json `code` here. Laravel converts an
    // AuthorizationException into an AccessDeniedHttpException in
    // prepareException(), which runs BEFORE the renderable callbacks, so the
    // AuthorizationException renderer in bootstrap/app.php never fires and a
    // 403 is not currently RFC 9457. Reported to the owner of that file; the
    // denial itself is what this test is for.
    $this->actingAs($pharmacist)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertForbidden();

    expect(app(Tenancy::class)->run($tenant->id, fn () => Prescription::query()->count()))->toBe(0);
});

it('rejects a field the prescribing form does not know about', function () {
    // A silently discarded typo is how a clinic finds out weeks later that a
    // direction was never saved.
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $payload = prescriptionPayload($consultation);
    $payload['items'][0]['dosage'] = 'two tablets';

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), $payload)
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonValidationErrors('items.0.dosage');
});

it('audits the issue with identifiers only, never what was prescribed', function () {
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated();

    $events = app(Tenancy::class)->run(
        $tenant->id,
        fn () => AuditEvent::query()->where('action', 'prescription.issued')->get()
    );

    expect($events)->toHaveCount(1);

    $recorded = strtolower(json_encode($events->toArray()) ?: '');

    foreach (['amoxicillin', 'capsule', 'directions', 'medicine'] as $clinical) {
        expect(str_contains($recorded, $clinical))->toBeFalse("The audit event leaked '{$clinical}'");
    }
});

// --- Reading ---------------------------------------------------------------

it('lists the prescriptions of the clinic and nobody else\'s', function () {
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated();

    // A second clinic issuing at the same moment must not appear.
    [$otherTenant, $otherUser, , $otherConsultation] = prescriptionFixture();

    $this->actingAs($otherUser)
        ->postJson(prescriptionApiUrl($otherTenant, '/api/v1/prescriptions'), prescriptionPayload($otherConsultation))
        ->assertCreated();

    $this->actingAs($user)
        ->getJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonStructure(['data' => [['id', 'status', 'issued_at', 'issued_by', 'items']]]);
});

it('returns 404, not 403, for a prescription belonging to another clinic', function () {
    // A 403 would confirm the prescription exists, which leaks that a person
    // is a patient of some other clinic. With RLS the row simply is not there.
    [$tenantA, $userA, , $consultationA] = prescriptionFixture();

    $id = $this->actingAs($userA)
        ->postJson(prescriptionApiUrl($tenantA, '/api/v1/prescriptions'), prescriptionPayload($consultationA))
        ->assertCreated()
        ->json('data.id');

    [$tenantB, $userB] = prescriptionFixture();

    $this->actingAs($userB)
        ->getJson(prescriptionApiUrl($tenantB, "/api/v1/prescriptions/{$id}"))
        ->assertNotFound()
        ->assertJsonPath('code', 'not_found');
});

// --- Correction ------------------------------------------------------------

it('exposes no route that would edit a prescription', function () {
    // Correction is cancel-and-replace. Nobody edits a prescription -- not the
    // clinician, not the administrator, not Carevelo -- and the absence of the
    // route is the enforcement.
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $id = $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated()
        ->json('data.id');

    $this->actingAs($user)
        ->putJson(prescriptionApiUrl($tenant, "/api/v1/prescriptions/{$id}"), ['status' => 'cancelled'])
        ->assertStatus(405);

    $this->actingAs($user)
        ->patchJson(prescriptionApiUrl($tenant, "/api/v1/prescriptions/{$id}"), ['status' => 'cancelled'])
        ->assertStatus(405);
});

it('records the reason when a prescription is cancelled', function () {
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $id = $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated()
        ->json('data.id');

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, "/api/v1/prescriptions/{$id}/cancel"), [
            'reason' => 'Quantity transcribed incorrectly',
        ])
        ->assertOk()
        ->assertJsonPath('data.status', PrescriptionStatus::Cancelled->value);

    app(Tenancy::class)->run($tenant->id, function () use ($id) {
        // sole(), so the cancellation is proved against exactly one row rather
        // than the first of several.
        $prescription = Prescription::query()->where('id', $id)->sole();

        expect($prescription->status)->toBe(PrescriptionStatus::Cancelled)
            ->and($prescription->getAttribute('cancellation_reason'))->toBe('Quantity transcribed incorrectly');
    });
});

it('requires a reason to cancel', function () {
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $id = $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated()
        ->json('data.id');

    $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, "/api/v1/prescriptions/{$id}/cancel"), [])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');
});

it('refuses to cancel a prescription twice', function () {
    // Cancelled is terminal. A second cancellation would rewrite a reason
    // somebody has already acted on.
    [$tenant, $user, , $consultation] = prescriptionFixture();

    $id = $this->actingAs($user)
        ->postJson(prescriptionApiUrl($tenant, '/api/v1/prescriptions'), prescriptionPayload($consultation))
        ->assertCreated()
        ->json('data.id');

    $url = prescriptionApiUrl($tenant, "/api/v1/prescriptions/{$id}/cancel");

    $this->actingAs($user)->postJson($url, ['reason' => 'Wrong quantity'])->assertOk();

    $this->actingAs($user)
        ->postJson($url, ['reason' => 'Changed my mind'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});
