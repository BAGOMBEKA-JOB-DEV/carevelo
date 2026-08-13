<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\ClinicalNote;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\ConsultationMode;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Factories\ClinicalNoteFactory;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| H3 -- the consultation encounter
|--------------------------------------------------------------------------
|
| Four behaviours here carry more weight than the happy path they surround:
|
|   1. only a clinician conducts a consultation;
|   2. mode_used records what ACTUALLY happened, not what was booked;
|   3. ending requires an outcome, because the exception paths are the product;
|   4. notes are corrected by addendum and never by overwrite.
|
| See docs/10-product/prd-h3-teleconsultation.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/** Tenancy comes from the host. It is never a path, query or body field. */
function consultationApiUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic, a confirmed video appointment, and the clinician who will hold it.
 *
 * @return array{Tenant, User, Appointment}
 */
function bookedVideoAppointment(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::Clinician->value);

        $clinician = Clinician::factory()->create(['user_id' => $user->id]);

        $appointment = Appointment::factory()->create([
            'clinician_id' => $clinician->id,
            'mode_booked' => ConsultationMode::Video,
        ]);

        return [$tenant, $user, $appointment];
    });
}

/** A staff user of the tenant holding one role. */
function consultationStaffOf(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

// --- Starting ---------------------------------------------------------------

it('starts a consultation when a clinician joins', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $response = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), [
            'appointment_id' => $appointment->id,
        ])
        ->assertCreated()
        ->assertJsonPath('data.appointment_id', $appointment->id)
        ->assertJsonPath('data.mode_used', 'video')
        ->assertJsonPath('data.outcome', null)
        ->assertJsonPath('data.ended_at', null);

    expect($response->json('data.started_at'))->not->toBeNull();

    // Assertions inside the tenant context: outside it RLS correctly hides the
    // rows, which is the isolation model working rather than a bug.
    app(Tenancy::class)->run($tenant->id, function () use ($appointment) {
        expect(Appointment::query()->find($appointment->id)?->status)
            ->toBe(AppointmentStatus::InProgress);
    });
});

it('refuses to let front desk conduct a consultation', function () {
    // Front desk books on the patient's behalf -- most bookings in year one are
    // made this way -- but a booking is not a clinical act.
    [$tenant, , $appointment] = bookedVideoAppointment();

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::FrontDesk))
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), [
            'appointment_id' => $appointment->id,
        ])
        ->assertForbidden();
});

it('refuses to let a clinic administrator conduct a consultation', function () {
    // An administrator may READ an encounter. Holding one would make the record
    // say a consultation happened with someone who is not a registered
    // practitioner of the clinic.
    [$tenant, , $appointment] = bookedVideoAppointment();

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::ClinicAdmin))
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), [
            'appointment_id' => $appointment->id,
        ])
        ->assertForbidden();
});

it('refuses a clinician role that is not linked to a clinician record', function () {
    // The role is an access grant. The Clinician record is the registration
    // with the UMDPC, AHPC or Nurses & Midwives Council, and only that makes
    // someone able to hold a consultation.
    [$tenant, , $appointment] = bookedVideoAppointment();

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::Clinician))
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), [
            'appointment_id' => $appointment->id,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('refuses to start a second consultation on one appointment', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $body = ['appointment_id' => $appointment->id];

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), $body)
        ->assertCreated();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), $body)
        ->assertStatus(409);
});

it('refuses an unauthenticated request', function () {
    [$tenant, , $appointment] = bookedVideoAppointment();

    $this->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), [
        'appointment_id' => $appointment->id,
    ])->assertUnauthorized();
});

// --- Mode -------------------------------------------------------------------

it('records a truthful step-down from the mode that was booked', function () {
    // THE mode test. Booked as video, held over voice, then chat. What is
    // stored is what happened -- video would be the flattering answer and the
    // dishonest one.
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/mode"), ['mode' => 'voice'])
        ->assertOk()
        ->assertJsonPath('data.mode_used', 'voice');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/mode"), ['mode' => 'chat'])
        ->assertOk()
        ->assertJsonPath('data.mode_used', 'chat');

    app(Tenancy::class)->run($tenant->id, function () use ($appointment, $consultationId) {
        expect(Consultation::query()->find((string) $consultationId)?->mode_used)->toBe(ConsultationMode::Chat)
            // The booking is untouched: what was agreed and what happened are
            // different facts, and both are worth keeping.
            ->and(Appointment::query()->find($appointment->id)?->mode_booked)->toBe(ConsultationMode::Video);
    });
});

it('records a mode chosen deliberately at the start', function () {
    // Voice is a first-class mode, not a failure. A clinician who knows the
    // patient's connection says so instead of fighting a dying video call.
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), [
            'appointment_id' => $appointment->id,
            'mode_used' => 'voice',
        ])
        ->assertCreated()
        ->assertJsonPath('data.mode_used', 'voice');
});

it('refuses to record in_person as the mode of a remote consultation', function () {
    // Remote care judged unsafe is an OUTCOME, converted_to_in_person, which
    // also forbids prescribing. It is not a mode field a client may flip.
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/mode"), ['mode' => 'in_person'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('refuses to record a mode after the consultation has ended', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), ['outcome' => 'completed'])
        ->assertOk();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/mode"), ['mode' => 'chat'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

// --- Ending -----------------------------------------------------------------

it('requires an outcome to end a consultation', function () {
    // A consultation that just stops records nothing about why, and why is the
    // part the clinic needs to count.
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), [])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonStructure(['errors' => ['outcome']]);
});

it('rejects an outcome that is not a ConsultationOutcome', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), [
            'outcome' => 'went_fine',
        ])
        ->assertStatus(422);
});

it('ends a consultation with an outcome and completes the appointment', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $response = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), [
            'outcome' => 'completed',
        ])
        ->assertOk()
        ->assertJsonPath('data.outcome', 'completed');

    expect($response->json('data.ended_at'))->not->toBeNull();

    app(Tenancy::class)->run($tenant->id, function () use ($appointment) {
        expect(Appointment::query()->find($appointment->id)?->status)->toBe(AppointmentStatus::Completed);
    });
});

it('ends a consultation the clinician judged unsafe for remote care', function () {
    // The branch that forbids a prescription downstream. It has to be
    // recordable at the moment the clinician decides.
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), [
            'outcome' => 'converted_to_in_person',
        ])
        ->assertOk()
        ->assertJsonPath('data.outcome', 'converted_to_in_person');

    app(Tenancy::class)->run($tenant->id, function () use ($consultationId) {
        expect(Consultation::query()->find((string) $consultationId)?->outcome?->permitsPrescribing())->toBeFalse();
    });
});

it('abandons the appointment when a dropped call cannot be resumed', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), [
            'outcome' => 'technical_failure',
        ])
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($appointment) {
        expect(Appointment::query()->find($appointment->id)?->status)->toBe(AppointmentStatus::Abandoned);
    });
});

// --- Reading ----------------------------------------------------------------

it('lets a clinic administrator read a consultation', function () {
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, '/api/v1/consultations'), ['appointment_id' => $appointment->id])
        ->json('data.id');

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}"))
        ->assertOk()
        ->assertJsonPath('data.id', $consultationId);
});

it('returns 404 not 403 for a consultation belonging to another clinic', function () {
    // A 403 would confirm the encounter exists, and that a given person
    // consulted a given clinic is itself health information.
    [$tenantA, $clinicianA, $appointmentA] = bookedVideoAppointment();

    $consultationId = $this->actingAs($clinicianA)
        ->postJson(consultationApiUrl($tenantA, '/api/v1/consultations'), ['appointment_id' => $appointmentA->id])
        ->json('data.id');

    [$tenantB, $clinicianB] = bookedVideoAppointment();

    $this->actingAs($clinicianB)
        ->getJson(consultationApiUrl($tenantB, "/api/v1/consultations/{$consultationId}"))
        ->assertNotFound();
});

// --- Clinical notes ---------------------------------------------------------

/**
 * A consultation already under way, plus the clinician conducting it.
 *
 * Built directly rather than through the start endpoint: these tests are about
 * what happens INSIDE an encounter, and starting one has its own tests above.
 *
 * @return array{Tenant, User, string}
 */
function consultationInProgress(): array
{
    [$tenant, $clinician, $appointment] = bookedVideoAppointment();

    $consultation = app(Tenancy::class)->run($tenant->id, function () use ($appointment) {
        $appointment->transitionTo(AppointmentStatus::InProgress);

        return Consultation::factory()->createOne([
            'appointment_id' => $appointment->id,
            'patient_id' => $appointment->patient_id,
            'clinician_id' => $appointment->clinician_id,
            'started_at' => now(),
            'ended_at' => null,
            'outcome' => null,
            'mode_used' => ConsultationMode::Video,
        ]);
    });

    return [$tenant, $clinician, $consultation->id];
}

it('saves a partial note as it is being typed', function () {
    // Drafts persist continuously. A half-finished sentence is a valid stored
    // note, not an edge case -- losing clinical text to a dropped connection is
    // the single most likely cause of a clinician abandoning the product.
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes"), [
            'body' => 'Patient reports a cough that started',
        ])
        ->assertCreated()
        ->assertJsonPath('data.note_type', 'subjective')
        ->assertJsonPath('data.supersedes_note_id', null);
});

it('keeps notes written before a connection was lost', function () {
    // Acceptance criterion 4: notes persist across a mid-consultation
    // disconnection. The consultation ends as technical_failure and the text
    // is still there afterwards.
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $notesUrl = consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes");

    $this->actingAs($clinician)->postJson($notesUrl, [
        'body' => 'Patient reports a cough that started',
    ])->assertCreated();

    $this->actingAs($clinician)->postJson($notesUrl, [
        'body' => 'Cough productive for four days, no fever',
        'note_type' => 'objective',
    ])->assertCreated();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/end"), [
            'outcome' => 'technical_failure',
        ])
        ->assertOk();

    $this->actingAs($clinician)
        ->getJson($notesUrl)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.body', 'Patient reports a cough that started')
        ->assertJsonPath('data.1.note_type', 'objective');
});

it('corrects a note by addendum, leaving the original exactly as written', function () {
    // THE immutability test. The addendum is a NEW note carrying
    // supersedes_note_id; the original is still returned, unchanged.
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $notesUrl = consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes");

    $originalId = $this->actingAs($clinician)
        ->postJson($notesUrl, ['body' => 'Assessment: viral upper respiratory infection'])
        ->assertCreated()
        ->json('data.id');

    $this->actingAs($clinician)
        ->patchJson("{$notesUrl}/{$originalId}", [
            'body' => 'Addendum: bacterial infection on review of the swab result',
        ])
        ->assertCreated()
        ->assertJsonPath('data.note_type', 'addendum')
        ->assertJsonPath('data.supersedes_note_id', $originalId);

    $this->actingAs($clinician)
        ->getJson($notesUrl)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $originalId)
        ->assertJsonPath('data.0.body', 'Assessment: viral upper respiratory infection')
        ->assertJsonPath('data.0.supersedes_note_id', null);
});

it('refuses to overwrite the body of an existing clinical note', function () {
    // No endpoint offers this. The model refuses it as well, because the
    // absence of a route is a design choice and this is the guarantee.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        $note = ClinicalNoteFactory::new()->createOne();
        $note->body = 'Rewritten after the fact';
        $note->save();
    });
})->throws(LogicException::class, 'never edited');

it('refuses to delete a clinical note', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        ClinicalNoteFactory::new()->createOne()->delete();
    });
})->throws(LogicException::class, 'never deleted');

it('returns 404 when the note belongs to a different consultation', function () {
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $strayNoteId = app(Tenancy::class)->run(
        $tenant->id,
        fn () => ClinicalNoteFactory::new()->createOne()->id
    );

    $this->actingAs($clinician)
        ->patchJson(
            consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes/{$strayNoteId}"),
            ['body' => 'Addendum against the wrong encounter']
        )
        ->assertNotFound();
});

it('refuses to let a clinic administrator author a clinical note', function () {
    // Reading an encounter and writing within it are different privileges.
    [$tenant, , $consultationId] = consultationInProgress();

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::ClinicAdmin))
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes"), [
            'body' => 'Added by the administrator',
        ])
        ->assertForbidden();
});

it('refuses a rider any access to clinical notes', function () {
    // The least-trusted actor in the system, and the one with no clinical need
    // whatsoever.
    [$tenant, , $consultationId] = consultationInProgress();

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::Rider))
        ->getJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes"))
        ->assertForbidden();
});

it('rejects a field the notes endpoint does not define', function () {
    // A misspelled field silently discarded would be clinical text the
    // clinician believes is recorded and is not.
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes"), [
            'body' => 'Assessment recorded',
            'diagnosis' => 'Written into a field that does not exist',
        ])
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['diagnosis']]);
});

// --- Disclosure -------------------------------------------------------------

it('never writes note text into the audit log', function () {
    // The audit log records THAT a note was written to WHICH consultation.
    // Never what it said. DPPA 2019, not a style preference.
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes"), [
            'body' => 'Suspected pulmonary tuberculosis, sputum sent',
        ])
        ->assertCreated();

    app(Tenancy::class)->run($tenant->id, function () {
        $events = AuditEvent::query()->where('action', 'clinical_note.recorded')->get();

        expect($events)->toHaveCount(1);

        $serialised = strtolower((string) json_encode($events->pluck('metadata')->all()));

        foreach (['tuberculosis', 'sputum', 'suspected'] as $term) {
            expect($serialised)->not->toContain($term, "Audit metadata leaked '{$term}'");
        }
    });
});

it('audits every read of a consultation', function () {
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $this->actingAs(consultationStaffOf($tenant, ClinicalRole::ClinicAdmin))
        ->getJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}"))
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($consultationId) {
        expect(
            AuditEvent::query()
                ->where('action', 'consultation.viewed')
                ->where('subject_id', $consultationId)
                ->exists()
        )->toBeTrue();
    });
});

it('keeps clinical content out of the consultation resource', function () {
    // The consultation is an operational record: who, when, how, and how it
    // ended. The note body is reachable only through the notes endpoint, which
    // audits the access.
    [$tenant, $clinician, $consultationId] = consultationInProgress();

    $this->actingAs($clinician)
        ->postJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}/notes"), [
            'body' => 'Suspected pulmonary tuberculosis, sputum sent',
        ])->assertCreated();

    $body = strtolower((string) json_encode(
        $this->actingAs($clinician)
            ->getJson(consultationApiUrl($tenant, "/api/v1/consultations/{$consultationId}"))
            ->assertOk()
            ->json()
    ));

    expect($body)->not->toContain('tuberculosis')
        ->and($body)->not->toContain('sputum');
});

it('has a note model that only ever creates addenda by addition', function () {
    // Guarding the mechanism itself rather than the endpoint that uses it.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        $original = ClinicalNoteFactory::new()->draft()->createOne();
        $addendum = $original->addendum('Corrected on review', (string) $original->author_id);

        expect($addendum->note_type)->toBe('addendum')
            ->and($addendum->supersedes_note_id)->toBe($original->id)
            ->and(ClinicalNote::query()->where('consultation_id', $original->consultation_id)->count())->toBe(2)
            ->and($original->refresh()->body)->toBe('Patient reports a cough that started');
    });
});
