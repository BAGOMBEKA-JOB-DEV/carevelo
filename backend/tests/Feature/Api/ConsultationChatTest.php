<?php

use App\Audit\AuditLog;
use App\Events\ConsultationMessageSent;
use App\Models\Appointment;
use App\Models\AuditEvent;
use App\Models\BreakGlassGrant;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\ConsultationMessage;
use App\Models\ConsultationMode;
use App\Models\ConsultationOutcome;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Platform\BreakGlassAccess;
use App\Services\Platform\TenantExport;
use App\Tenancy\Tenancy;
use Database\Factories\ConsultationMessageFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| Consultation chat -- a CLINICAL RECORD, not ephemeral messaging
|--------------------------------------------------------------------------
|
| Two documents already promised this existed. docs/50-security-compliance/
| threat-model.md answers "video provider outage" with "fall back to chat, which
| we serve ourselves", and docs/30-architecture/integrations.md says the same
| thing in its failure table. Until this domain shipped, a video outage fell back
| to a notice and a telephone number -- and now that the SFU is self-hosted, the
| outage those tables describe is one we operate ourselves.
|
| The decision that shapes every test below: A CHAT MESSAGE IS PART OF THE
| CLINICAL RECORD. The "consultations are not recorded" non-goal is about MEDIA.
| Text a clinician types is a clinical instruction and text a patient types is
| history, and docs/30-architecture/realtime-and-video.md states it positively:
| "Chat messages within a consultation are clinical data, stored in-tenant,
| subject to RLS, and never sent by SMS."
|
| So each test here proves a RULE rather than a happy path:
|
|   1. a patient reaches their own encounter's transcript and no other's;
|   2. cross-tenant is 404 and not 403 -- WHICH encounter a message belongs to
|      is itself health information;
|   3. the body reaches no audit event, no log line and no broadcast frame;
|   4. a clinician who is not conducting this encounter reaches neither verb;
|   5. THE PATIENT CAN WRITE -- the test that catches the `conduct` trap;
|   6. a message leaves with the clinic in the export, and is reachable under a
|      break-glass grant that names its own scope;
|   7. chat works with no video provider configured, which is the entire point;
|   8. the record is append-only, and there is no route that says otherwise.
|
| @see app/Policies/ConsultationPolicy.php participate()
| @see docs/30-architecture/realtime-and-video.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function chatUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function chatMessagesUrl(Tenant $tenant, string $consultationId): string
{
    return chatUrl($tenant, "/api/v1/consultations/{$consultationId}/messages");
}

/** A staff user of the tenant holding one role. */
function chatStaffOf(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A patient of the clinic WITH a signed-in account of their own.
 *
 * The account link is what the whole patient side turns on: ConsultationPolicy
 * resolves "is this their consultation" through User::owns(), which reads the
 * patient records the account is linked to. A patient user with no linked
 * record owns nothing and is refused everywhere, which is the safe direction.
 *
 * @return array{User, Patient}
 */
function chatPatientOf(Tenant $tenant, string $phone): array
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $phone) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => $phone]);
        $user->assignRole(ClinicalRole::Patient->value);

        $patient = Patient::factory()->create(['phone' => $phone]);
        $patient->user_id = $user->id;
        $patient->save();

        return [$user, $patient];
    });
}

/**
 * One clinic mid-consultation, plus everybody who must NOT be in it.
 *
 * `otherClinician` is the fixture that matters most and is easiest to leave out:
 * a second, entirely legitimate clinician of the SAME clinic, holding the same
 * role, who simply is not conducting this encounter. Row-level security is
 * perfectly satisfied by them -- the rows are their clinic's -- so authorisation
 * is the whole control, exactly as it is between two patients of one clinic.
 *
 * @return array{
 *     tenant: Tenant,
 *     consultation: Consultation,
 *     clinician: User,
 *     patient: User,
 *     otherClinician: User,
 *     otherPatient: User,
 * }
 */
function chatFixture(): array
{
    $tenant = Tenant::factory()->create();

    [$patientUser, $patient] = chatPatientOf($tenant, '+256772000111');
    [$otherPatientUser] = chatPatientOf($tenant, '+256772000222');

    $clinicianUser = chatStaffOf($tenant, ClinicalRole::Clinician);
    $otherClinicianUser = chatStaffOf($tenant, ClinicalRole::Clinician);

    $consultation = app(Tenancy::class)->run(
        $tenant->id,
        function () use ($clinicianUser, $otherClinicianUser, $patient) {
            $clinician = Clinician::factory()->create(['user_id' => $clinicianUser->id]);

            // Given a clinician record of their own, so the only thing
            // separating them from this encounter is that it is not theirs.
            Clinician::factory()->create(['user_id' => $otherClinicianUser->id]);

            $appointment = Appointment::factory()->create([
                'patient_id' => $patient->id,
                'clinician_id' => $clinician->id,
                'mode_booked' => ConsultationMode::Video,
            ]);

            return Consultation::factory()->create([
                'appointment_id' => $appointment->id,
                'patient_id' => $patient->id,
                'clinician_id' => $clinician->id,
                'started_at' => now(),
                'ended_at' => null,
                'outcome' => null,
                'mode_used' => ConsultationMode::Chat,
            ]);
        }
    );

    return [
        'tenant' => $tenant,
        'consultation' => $consultation,
        'clinician' => $clinicianUser,
        'patient' => $patientUser,
        'otherClinician' => $otherClinicianUser,
        'otherPatient' => $otherPatientUser,
    ];
}

// --- Rule 5 -- the patient can write ----------------------------------------

it('lets the patient send a message in their own consultation', function () {
    /*
     * THE TEST THAT WOULD HAVE CAUGHT THE TRAP, so it goes first.
     *
     * ClinicalNote is the analogue for everything else in this domain, and it
     * authorises writes with ConsultationPolicy::conduct -- Clinician-only, on
     * purpose, because "an administrator who may read the encounter may not
     * author within it". Copying that here would have compiled, passed every
     * other test in this file, and shipped a chat window the patient can read
     * and cannot answer: a fallback for a video outage that only one side of the
     * call can use.
     *
     * Hence `participate`, and hence this test.
     */
    $chat = chatFixture();

    $this->actingAs($chat['patient'])
        ->postJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id), [
            'body' => 'The pain moved to my right side this morning',
        ])
        ->assertCreated()
        ->assertJsonPath('data.author_role', 'patient')
        ->assertJsonPath('data.author_id', $chat['patient']->id)
        ->assertJsonPath('data.body', 'The pain moved to my right side this morning');
});

it('carries both voices in one transcript, in the order they were said', function () {
    // A conversation, not two logs. The ordering is fixed on the relation
    // rather than left to each caller: a transcript read back in the wrong
    // order is a different conversation, and clinically that can invert an
    // instruction and the question that prompted it.
    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);

    $this->actingAs($chat['patient'])
        ->postJson($url, ['body' => 'Should I keep taking the tablets?'])
        ->assertCreated();

    $this->actingAs($chat['clinician'])
        ->postJson($url, ['body' => 'Yes, finish the course even once you feel better'])
        ->assertCreated();

    $this->actingAs($chat['patient'])
        ->getJson($url)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.author_role', 'patient')
        ->assertJsonPath('data.0.body', 'Should I keep taking the tablets?')
        ->assertJsonPath('data.1.author_role', 'clinician')
        ->assertJsonPath('data.1.body', 'Yes, finish the course even once you feel better');
});

it('refuses to let a sender declare which side they are speaking for', function () {
    // author_role is derived from the authorisation decision, never taken from
    // the request. A patient who could assert it would be putting words into
    // their clinician's mouth INSIDE THE CLINICAL RECORD -- and a silently
    // discarded field would have made that look like it worked.
    $chat = chatFixture();

    $this->actingAs($chat['patient'])
        ->postJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id), [
            'body' => 'Take two of the white tablets each morning',
            'author_role' => 'clinician',
        ])
        ->assertStatus(422)
        ->assertJsonStructure(['errors' => ['author_role']]);
});

// --- Rule 1 -- a patient reads only their own encounter ---------------------

it('refuses another patient of the same clinic both verbs', function () {
    /*
     * ROW-LEVEL SECURITY IS NO HELP HERE AT ALL: both patients belong to this
     * clinic, so every row is legitimately visible to the tenant and the
     * database is satisfied either way. Authorisation is the entire control,
     * which is why both verbs are asserted rather than just the read.
     */
    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);

    $this->actingAs($chat['otherPatient'])->getJson($url)
        ->assertForbidden()
        ->assertJsonPath('code', 'forbidden');

    $this->actingAs($chat['otherPatient'])
        ->postJson($url, ['body' => 'Reading a stranger\'s consultation'])
        ->assertForbidden()
        ->assertJsonPath('code', 'forbidden');
});

// --- Rule 4 -- only the clinician conducting this encounter ------------------

it('refuses a clinician who is not conducting this consultation', function () {
    /*
     * A DELIBERATE DIVERGENCE FROM ClinicalNote, and the sharpest one in this
     * domain. Notes are authorised with view()/conduct(), so any clinician of
     * the clinic may read a note and any clinician may write one -- correct for
     * a shared clinical document.
     *
     * A conversation is not a shared document. A clinician down the corridor is
     * not in this call, and the RBAC matrix already says so for this encounter's
     * realtime channel: `tenant.{id}.consultation.{id}` is "own" for the
     * clinician, "own" for the patient, and a dash for the administrator. The
     * chat transcript is that channel's content.
     */
    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);

    $this->actingAs($chat['otherClinician'])->getJson($url)->assertForbidden();

    $this->actingAs($chat['otherClinician'])
        ->postJson($url, ['body' => 'Speaking into somebody else\'s encounter'])
        ->assertForbidden();
});

it('refuses a clinic administrator, who may read the encounter but is not in it', function () {
    // The administrator may read the consultation itself -- administrators of
    // small clinics genuinely need that, and every such read is audited. Being
    // able to read WHO was seen and WHEN is not being a party to what was said.
    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);
    $admin = chatStaffOf($chat['tenant'], ClinicalRole::ClinicAdmin);

    $this->actingAs($admin)->getJson($url)->assertForbidden();
    $this->actingAs($admin)->postJson($url, ['body' => 'Added by the administrator'])->assertForbidden();
});

it('refuses a rider any access to a consultation transcript', function () {
    // The least-trusted actor in the system and the one with no clinical need
    // whatsoever. Asserted here as well as on the notes, because a new endpoint
    // is a new chance to forget.
    $chat = chatFixture();

    $this->actingAs(chatStaffOf($chat['tenant'], ClinicalRole::Rider))
        ->getJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id))
        ->assertForbidden();
});

it('refuses a clinician whose account has been deactivated', function () {
    // Deactivation revokes participation exactly as it revokes a role. A
    // practitioner who has left the clinic must stop being able to speak in
    // encounters that still name them as the conducting clinician.
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        $chat['clinician']->is_active = false;
        $chat['clinician']->save();
    });

    $this->actingAs($chat['clinician'])
        ->postJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id), [
            'body' => 'Still typing after leaving the clinic',
        ])
        ->assertForbidden();
});

// --- Rule 2 -- cross-tenant is 404, not 403 ---------------------------------

it('answers 404 and not 403 for another clinic\'s consultation', function () {
    /*
     * A 403 would CONFIRM the encounter exists. That is a disclosure in its own
     * right and a sharper one than usual here: which consultation a message
     * belongs to is itself health information, so "this identifier is a real
     * consultation at some other clinic" tells an attacker that a named person
     * was seen somewhere.
     *
     * With row-level security bound to the requested host's tenant the row is
     * simply not there, and route model binding answers not-found without any
     * policy running at all.
     */
    $clinicA = chatFixture();
    $clinicB = chatFixture();

    $strayUrl = chatMessagesUrl($clinicB['tenant'], $clinicA['consultation']->id);

    $this->actingAs($clinicB['clinician'])->getJson($strayUrl)
        ->assertNotFound()
        ->assertJsonPath('code', 'not_found');

    $this->actingAs($clinicB['clinician'])
        ->postJson($strayUrl, ['body' => 'Reaching across the isolation boundary'])
        ->assertNotFound()
        ->assertJsonPath('code', 'not_found');
});

it('keeps one clinic\'s transcript out of another clinic\'s database session', function () {
    // The control behind the 404, asserted directly rather than inferred from a
    // status code: the row is invisible to a session bound to the other tenant,
    // so even code that forgot to authorise would find nothing.
    $clinicA = chatFixture();
    $clinicB = chatFixture();

    app(Tenancy::class)->run($clinicA['tenant']->id, function () use ($clinicA) {
        ConsultationMessageFactory::new()->createOne([
            'consultation_id' => $clinicA['consultation']->id,
            'author_id' => $clinicA['clinician']->id,
            'body' => 'Sputum sample sent to the laboratory',
        ]);
    });

    $visibleToB = app(Tenancy::class)->run(
        $clinicB['tenant']->id,
        fn (): int => ConsultationMessage::query()->count(),
    );

    expect($visibleToB)->toBe(0);
});

// --- Rule 3 -- the body reaches no audit event, log line or frame -----------

it('never lets a message body reach an audit event, a log line or a broadcast', function () {
    /*
     * THE MOST IMPORTANT TEST IN THIS FILE, and it asserts on three surfaces at
     * once because a body escaping by any one of them is the same breach.
     *
     * The broadcast assertion is made against the SERIALISED frame -- what
     * actually leaves the building -- and not against the event object, because
     * an event that merely holds the model would pass an inspection of
     * broadcastWith() and still put the body on the wire when a queue worker
     * serialised it. TenantBroadcast forbids holding a model at all; this is the
     * check that the rule was actually followed here.
     *
     * The channel is WIDER than the endpoint, which is why this matters more for
     * chat than for anything else in app/Events: ConsultationChannel authorises
     * with ConsultationPolicy::view, so a clinic administrator may subscribe to
     * a conversation they are forbidden to read. A channel is not an
     * authorisation boundary. The payload rule is what makes that safe.
     *
     * EVERY CONTENT CHECK BELOW IS str_contains() AND toBeFalse(), NEVER
     * `->not->toContain($term, "… leaked '{$term}'")`, WHICH IS THE HOUSE
     * IDIOM AND IS INERT.
     *
     * Pest's toContain() is variadic -- `toContain(mixed ...$needles)` -- so a
     * message passed as a second argument is not a message, it is a SECOND
     * NEEDLE. `not` is implemented by running the positive expectation and
     * catching its failure, so the whole thing passes the moment ANY needle is
     * absent. The message text is never in the payload, so it was absent every
     * time, so the assertion passed whether or not the body leaked.
     *
     * Not reasoned about: putting the message body into
     * ConsultationMessageSent::broadcastWith() was NOT detected by the old form
     * and IS detected by this one. toBeFalse() takes a real `string $message`,
     * so the diagnostic is kept.
     *
     * The same idiom appears about forty times across tests/ on assertions
     * about credentials, patient names and clinical content. Every one of them
     * is inert, and each is reported separately rather than rewritten from
     * inside this domain's diff.
     */
    Event::fake([ConsultationMessageSent::class]);

    $logged = [];
    Log::listen(function (MessageLogged $entry) use (&$logged): void {
        $logged[] = strtolower($entry->message.' '.((string) json_encode($entry->context)));
    });

    $chat = chatFixture();

    $this->actingAs($chat['clinician'])
        ->postJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id), [
            'body' => 'Suspected pulmonary tuberculosis, sputum sent',
        ])
        ->assertCreated();

    $forbidden = ['tuberculosis', 'sputum', 'suspected', 'pulmonary'];

    // 1. THE AUDIT EVENT. It records THAT a message was sent to WHICH encounter
    //    by WHICH side, and audit_events is exported, readable by clinic
    //    administrators and append-only -- so a leak here cannot be taken back.
    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat, $forbidden) {
        $events = AuditEvent::query()->where('action', 'consultation_message.sent')->get();

        expect($events)->toHaveCount(1);

        $event = $events->first();

        expect($event?->subject_type)->toBe('consultation_message')
            ->and($event?->metadata)->toEqualCanonicalizing([
                'consultation_id' => $chat['consultation']->id,
                'author_role' => 'clinician',
            ]);

        // The whole row, not just the metadata: a body smuggled into
        // subject_type or an action name would be just as exported.
        $serialised = strtolower((string) json_encode($event?->toArray()));

        foreach ($forbidden as $term) {
            expect(str_contains($serialised, $term))
                ->toBeFalse("The audit event leaked '{$term}'");
        }
    });

    // 2. THE LOG. Nothing in this path should log at all, but the assertion is
    //    on content rather than on silence, so a future debug line that happens
    //    to be harmless does not fail while one carrying the text does.
    foreach ($logged as $line) {
        foreach ($forbidden as $term) {
            expect(str_contains($line, $term))->toBeFalse("A log line leaked '{$term}'");
        }
    }

    // 3. THE FRAME, as encoded.
    Event::assertDispatched(ConsultationMessageSent::class, function (ConsultationMessageSent $event) use ($chat, $forbidden) {
        $payload = (array) json_decode((string) json_encode($event->broadcastWith()), true);

        $encoded = strtolower((string) json_encode($payload));

        foreach ($forbidden as $term) {
            expect(str_contains($encoded, $term))
                ->toBeFalse("The broadcast payload leaked '{$term}'");
        }

        // An allow-list, not a deny-list: a new field has to be argued for here
        // before it can reach a socket. Flat scalars only -- a nested object is
        // a model in disguise.
        expect(array_keys($payload))
            ->toEqualCanonicalizing(['consultation_id', 'message_id', 'author_role']);

        foreach ($payload as $value) {
            expect(is_string($value))->toBeTrue();
        }

        // And addressed to the encounter's own private, tenant-prefixed channel.
        foreach ($event->broadcastOn() as $channel) {
            expect((string) $channel)
                ->toBe("private-tenant.{$chat['tenant']->id}.consultation.{$chat['consultation']->id}");
        }

        return true;
    });
});

it('audits a transcript read with a count and never a line', function () {
    // "Who read my consultation?" can only be answered by having recorded every
    // read, so reads are audited as well as writes -- and the record of a read
    // must not itself become a second copy of what was read.
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        ConsultationMessageFactory::new()->createOne([
            'consultation_id' => $chat['consultation']->id,
            'author_id' => $chat['clinician']->id,
            'body' => 'Suspected pulmonary tuberculosis, sputum sent',
        ]);
    });

    $this->actingAs($chat['patient'])
        ->getJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id))
        ->assertOk()
        ->assertJsonCount(1, 'data');

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        $event = AuditEvent::query()
            ->where('action', 'consultation_message.viewed')
            ->where('subject_id', $chat['consultation']->id)
            ->firstOrFail();

        expect($event->metadata)->toEqualCanonicalizing(['message_count' => 1]);

        expect(strtolower((string) json_encode($event->toArray())))
            ->not->toContain('tuberculosis');
    });
});

it('drops a body a careless caller hands to the audit log', function () {
    /*
     * Defence in depth on AuditLog::scrub, and the key names are the point. A
     * developer who would never write 'diagnosis' into an audit event will write
     * 'body' or 'message' without a second thought, because inside a chat domain
     * those read as the name of the thing rather than as clinical content.
     */
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () {
        $event = app(AuditLog::class)->record('consultation_message.sent', 'consultation_message', 'x', [
            'body' => 'Suspected pulmonary tuberculosis',
            'message' => 'Suspected pulmonary tuberculosis',
            'transcript' => 'Suspected pulmonary tuberculosis',
            'author_role' => 'clinician',
        ]);

        expect($event->metadata)->toEqualCanonicalizing(['author_role' => 'clinician']);
    });
});

it('keeps the transcript out of the consultation resource', function () {
    // The consultation is an operational record: who, when, how, and how it
    // ended. The messages are reachable only through their own endpoint, which
    // audits the access and applies the narrower ability.
    $chat = chatFixture();

    $this->actingAs($chat['clinician'])
        ->postJson(chatMessagesUrl($chat['tenant'], $chat['consultation']->id), [
            'body' => 'Suspected pulmonary tuberculosis, sputum sent',
        ])->assertCreated();

    $body = strtolower((string) json_encode(
        $this->actingAs($chat['clinician'])
            ->getJson(chatUrl($chat['tenant'], "/api/v1/consultations/{$chat['consultation']->id}"))
            ->assertOk()
            ->json()
    ));

    expect($body)->not->toContain('tuberculosis')
        ->and($body)->not->toContain('sputum');
});

// --- Rule 7 -- chat works with no video provider ----------------------------

it('works with the video provider unconfigured, which is the whole point of it', function () {
    /*
     * THE REASON THIS DOMAIN EXISTS, asserted rather than assumed.
     *
     * The threat model and the integrations document both answer a video
     * outage with "falls back to chat, which we serve ourselves". A chat that
     * needed a join token, a room or a reachable SFU would be unavailable in
     * precisely the outage it is the mitigation for -- and self-hosting makes
     * that sharper, because the SFU that goes down is now ours.
     *
     * Unset rather than merely wrong: config('video.livekit.api_secret') with no
     * value is the state a clinic is in before video is configured at all, and
     * chat has to be a working product in it.
     */
    config([
        'video.livekit.api_key' => null,
        'video.livekit.api_secret' => null,
        'video.livekit.url' => null,
    ]);

    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);

    $this->actingAs($chat['clinician'])
        ->postJson($url, ['body' => 'Video is down; describing the rash here instead'])
        ->assertCreated();

    $this->actingAs($chat['patient'])
        ->postJson($url, ['body' => 'It is on both forearms and it itches'])
        ->assertCreated();

    $this->actingAs($chat['patient'])->getJson($url)->assertOk()->assertJsonCount(2, 'data');
});

// --- Rule 8 -- append-only, and no route says otherwise ---------------------

it('refuses to edit a message that has been sent', function () {
    /*
     * STRICTER THAN ClinicalNote, DELIBERATELY. A note refuses a changed `body`
     * and permits other columns to move, because it has a correction mechanism
     * of its own -- an addendum is a NEW note carrying supersedes_note_id, and
     * note_type is part of that machinery.
     *
     * Chat has no such mechanism and needs none: a person who mistyped
     * something in a conversation corrects it by saying something else, which
     * leaves the original visible, as a medical record requires. So there is no
     * legitimate mutation of a sent message at all and ANY update throws.
     */
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        $message = ConsultationMessageFactory::new()->createOne([
            'consultation_id' => $chat['consultation']->id,
            'author_id' => $chat['clinician']->id,
        ]);

        $message->body = 'Rewritten after the fact';
        $message->save();
    });
})->throws(LogicException::class, 'never edited');

it('refuses to delete a message that has been sent', function () {
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        ConsultationMessageFactory::new()->createOne([
            'consultation_id' => $chat['consultation']->id,
            'author_id' => $chat['clinician']->id,
        ])->delete();
    });
})->throws(LogicException::class, 'never deleted');

it('exposes no verb that could rewrite or remove a message', function () {
    // The model refuses it, and the API never offers it. The absence of a route
    // is a design decision, so it is asserted rather than left to be noticed.
    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);

    $this->actingAs($chat['clinician'])->patchJson($url, ['body' => 'Rewritten'])
        ->assertStatus(405);

    $this->actingAs($chat['clinician'])->deleteJson($url)->assertStatus(405);
});

it('accepts no further messages once the consultation has ended', function () {
    /*
     * A DIVERGENCE FROM ClinicalNoteController, which accepts a note after the
     * encounter closes -- correctly, because clinicians write their notes up
     * afterwards and a note is addressed to the record.
     *
     * A message is addressed to a PERSON. Accepting one into a closed
     * consultation turns this into asynchronous clinical messaging: the patient
     * types a new symptom, sees it delivered, and reasonably believes a
     * clinician is reading it. Nobody is. That is a patient-safety failure
     * dressed as a feature.
     *
     * The transcript stays readable, because it is the record.
     */
    $chat = chatFixture();
    $url = chatMessagesUrl($chat['tenant'], $chat['consultation']->id);

    $this->actingAs($chat['clinician'])
        ->postJson($url, ['body' => 'Finish the course even once you feel better'])
        ->assertCreated();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        $chat['consultation']->end(ConsultationOutcome::Completed);
    });

    $this->actingAs($chat['patient'])
        ->postJson($url, ['body' => 'A new symptom, three days later'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    // Still readable. A record you cannot read back is not one.
    $this->actingAs($chat['patient'])->getJson($url)->assertOk()->assertJsonCount(1, 'data');
});

// --- Rule 6 -- the export and break-glass -----------------------------------

it('sends the transcript out with the clinic in the offboarding export', function () {
    /*
     * TenantExport::CONTENTS is an explicit list because a silent omission from
     * an export is the kind of gap nobody notices until a clinic has already
     * left -- and chat is exactly the shape of thing that gets omitted, because
     * a table of messages reads as infrastructure rather than as a medical
     * record. A clinic leaving without its transcripts would leave without
     * clinical instructions its clinicians gave.
     */
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        ConsultationMessageFactory::new()->createOne([
            'consultation_id' => $chat['consultation']->id,
            'author_id' => $chat['clinician']->id,
            'body' => 'Finish the course even once you feel better',
        ]);
    });

    $export = app(TenantExport::class)->for($chat['tenant']);

    expect($export['records'])->toHaveKey('consultation_messages')
        ->and($export['counts']['consultation_messages'])->toBe(1);

    $rows = $export['records']['consultation_messages'];

    // The raw stored row, not a resource's chosen subset. An export is the
    // clinic's own data, and a resource class exists to withhold.
    expect($rows[0]['body'])->toBe('Finish the course even once you feel better')
        ->and($rows[0]['author_role'])->toBe('clinician')
        ->and($rows[0]['consultation_id'])->toBe($chat['consultation']->id);
});

it('reaches a transcript under a break-glass grant that names its own scope', function () {
    /*
     * THE SCOPE DECISION, ASSERTED IN BOTH DIRECTIONS.
     *
     * `consultation_message` is a scope of its own rather than folded into
     * `consultation`. The scope list already draws exactly this distinction --
     * `consultation` is the encounter as an operational record, `clinical_note`
     * is the text written inside it -- and the commonest real grant is a support
     * ticket saying "the clinic cannot open a record". Folding chat into
     * `consultation` would have made every scheduling-bug grant silently unlock
     * a transcript of what a patient told their doctor.
     *
     * So the second half of this test is the half that matters: a live,
     * notified, in-time-box `consultation` grant reaches the encounter and is
     * REFUSED the conversation.
     */
    $chat = chatFixture();

    app(Tenancy::class)->run($chat['tenant']->id, function () use ($chat) {
        ConsultationMessageFactory::new()->createOne([
            'consultation_id' => $chat['consultation']->id,
            'author_id' => $chat['clinician']->id,
            'body' => 'Finish the course even once you feel better',
        ]);
    });

    $operator = User::factory()->create(['tenant_id' => null]);
    $operator->assignRole(ClinicalRole::PlatformSupport->value);

    BreakGlassGrant::factory()->forScope('consultation_message')->create([
        'tenant_id' => $chat['tenant']->id,
        'operator_id' => $operator->id,
    ]);

    $body = app(BreakGlassAccess::class)->underGrant(
        $operator,
        $chat['tenant']->id,
        'consultation_message',
        fn (): ?string => ConsultationMessage::query()->value('body'),
    );

    expect($body)->toBe('Finish the course even once you feel better');

    // The access lands in the CLINIC'S own trail, so the controller can see what
    // its processor read -- and it names the scope, not the text.
    app(Tenancy::class)->run($chat['tenant']->id, function () {
        $event = AuditEvent::query()->where('action', 'break_glass.accessed')->firstOrFail();

        expect($event->metadata['scope'] ?? null)->toBe('consultation_message')
            ->and(strtolower((string) json_encode($event->toArray())))->not->toContain('finish the course');
    });

    // And the deliberate half: an encounter-scoped grant does not open the
    // conversation. Widening a scope means issuing a new grant, which the clinic
    // is told about and which is audited in its own right.
    $encounterOnly = User::factory()->create(['tenant_id' => null]);
    $encounterOnly->assignRole(ClinicalRole::PlatformSupport->value);

    BreakGlassGrant::factory()->forScope('consultation')->create([
        'tenant_id' => $chat['tenant']->id,
        'operator_id' => $encounterOnly->id,
    ]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $encounterOnly,
        $chat['tenant']->id,
        'consultation_message',
        fn (): int => ConsultationMessage::query()->count(),
    ))->toThrow(AuthorizationException::class);
});
