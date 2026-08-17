<?php

use App\Models\Appointment;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\DispenseOrder;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\Prescription;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Factories\ConsentRecordFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| H2 — folding a duplicate registration into the record that survives
|--------------------------------------------------------------------------
|
| Front desk registers the same person twice: a mistyped number, a second
| handset, a name spelled differently on a second visit. Merging moves the
| clinical history onto one record.
|
| The endpoint was bound in routes/api.php with no method behind it, so every
| merge was a 500. What matters most in the implementation is not the happy path
| but the two things it deliberately does NOT do:
|
|   - it does not DELETE the duplicate. Nobody deletes a patient;
|   - it does not recompute the survivor's status from the consent records it
|     inherits. Silently promoting a record to `active` because a DIFFERENT
|     registration once consented is how clinical data ends up attached to
|     someone who never agreed to any of it.
|
| Every fixture and every assertion runs inside Tenancy::run(). Outside it,
| row-level security correctly hides the rows and an assertion would pass by
| seeing nothing at all.
|
| @see docs/10-product/prd-h2-patient-registration-consent.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function mergeUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function mergeStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * The same person, registered twice, with history on the duplicate.
 *
 * @return array{Tenant, Patient, Patient}
 */
function mergePair(): array
{
    $tenant = Tenant::factory()->create();

    [$survivor, $duplicate] = app(Tenancy::class)->run($tenant->id, function () {
        $survivor = Patient::factory()->create([
            'given_name' => 'Nakato',
            'family_name' => 'Ssentongo',
        ]);

        $duplicate = Patient::factory()->create([
            'given_name' => 'Nakatoo',
            'family_name' => 'Ssentongo',
        ]);

        return [$survivor, $duplicate];
    });

    return [$tenant, $survivor, $duplicate];
}

it('moves the duplicate history onto the surviving record', function () {
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    $appointment = app(Tenancy::class)->run($tenant->id, function () use ($duplicate, $frontDesk) {
        $clinician = Clinician::factory()->create(['user_id' => $frontDesk->id]);

        return Appointment::factory()->create([
            'patient_id' => $duplicate->id,
            'clinician_id' => $clinician->id,
        ]);
    });

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertOk()
        ->assertJsonPath('data.id', $survivor->id);

    app(Tenancy::class)->run($tenant->id, function () use ($appointment, $survivor, $duplicate) {
        expect($appointment->fresh()?->patient_id)->toBe($survivor->id);

        // The duplicate SURVIVES, pointing at the winner. Staff who reach it by
        // an old link need somewhere to go.
        $stale = $duplicate->fresh();

        expect($stale)->not->toBeNull()
            ->and($stale?->merged_into_patient_id)->toBe($survivor->id);
    });
});

it('leaves nothing behind in any table that names a patient', function () {
    // The tables are DERIVED FROM THE SCHEMA rather than listed here, so this is
    // also the guard on PatientController::MERGED_RELATIONS. A new patient-owning
    // table added without being merged strands that history on the duplicate,
    // where no clinician will ever look for it again.
    //
    // Asserting the survivor gained a row is what makes the guard bite: a table
    // this test does not seed shows up as a survivor count of zero, which is the
    // failure telling the author to handle it in both places.
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    app(Tenancy::class)->run($tenant->id, function () use ($duplicate) {
        $owned = ['patient_id' => $duplicate->id];

        ConsentRecordFactory::new()->create($owned);
        Appointment::factory()->create($owned);
        Consultation::factory()->create($owned);
        Prescription::factory()->create($owned);
        DispenseOrder::factory()->create($owned);
    });

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($survivor, $duplicate) {
        $tables = array_map(
            static fn (stdClass $row): string => (string) $row->table_name,
            DB::select("
                select table_name
                from information_schema.columns
                where table_schema = 'public' and column_name = 'patient_id'
                order by table_name
            "),
        );

        expect($tables)->not->toBeEmpty();

        foreach ($tables as $table) {
            expect(DB::table($table)->where('patient_id', $duplicate->id)->count())
                ->toBe(0, "{$table} still points at the merged duplicate");

            expect(DB::table($table)->where('patient_id', $survivor->id)->count())
                ->toBeGreaterThan(0, "{$table} was never merged onto the survivor");
        }
    });
});

it('leaves the surviving record status alone', function () {
    // The survivor inherits the duplicate's consent RECORDS but not its
    // standing. A merge is a clerical correction, never a consent event, and
    // promoting a pending registration to active here would attach clinical
    // history to someone this clinic never got consent from.
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    app(Tenancy::class)->run($tenant->id, function () use ($survivor, $duplicate) {
        $survivor->status = PatientStatus::PendingConsent;
        $survivor->save();

        $duplicate->status = PatientStatus::Active;
        $duplicate->save();

        ConsentRecordFactory::new()->create(['patient_id' => $duplicate->id]);
    });

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertOk()
        ->assertJsonPath('data.status', PatientStatus::PendingConsent->value);
});

it('drops the merged duplicate from the patient list', function () {
    // A merged duplicate holds no history any more. Listing it invites staff to
    // open the empty half of a person.
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertOk();

    $this->actingAs($frontDesk)
        ->getJson(mergeUrl($tenant, '/api/v1/patients'))
        ->assertOk()
        // One person, one row. Two registrations went in and the list shows the
        // record that kept the history.
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $survivor->id);
});

it('refuses to merge a record into itself', function () {
    [$tenant, $survivor] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $survivor->id,
        ])
        ->assertStatus(422)
        ->assertJsonPath('errors.duplicate_patient_id.0', 'A record cannot be merged into itself.');
});

it('refuses to merge the same duplicate twice', function () {
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    $payload = ['duplicate_patient_id' => $duplicate->id];

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), $payload)
        ->assertOk();

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), $payload)
        ->assertStatus(409);
});

it('refuses to merge into a record that was itself merged away', function () {
    // Otherwise history lands on a tombstone and disappears from every list.
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    $third = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertOk();

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$duplicate->id}/merge"), [
            'duplicate_patient_id' => $third->id,
        ])
        ->assertStatus(409);
});

it('refuses a merge by a clinician', function () {
    // A clinician may correct a record but should not be re-pointing which
    // record a consultation belongs to. This is a registration-desk correction.
    [$tenant, $survivor, $duplicate] = mergePair();
    $clinician = mergeStaff($tenant, ClinicalRole::Clinician);

    $this->actingAs($clinician)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertForbidden();
});

it('never merges across clinics', function () {
    // The isolation boundary is absolute. There is no cross-tenant patient
    // identity to merge onto, and the foreign id simply does not resolve.
    [$tenantA, $survivorA] = mergePair();
    [, , $duplicateB] = mergePair();

    $frontDeskA = mergeStaff($tenantA, ClinicalRole::FrontDesk);

    $this->actingAs($frontDeskA)
        ->postJson(mergeUrl($tenantA, "/api/v1/patients/{$survivorA->id}/merge"), [
            'duplicate_patient_id' => $duplicateB->id,
        ])
        ->assertStatus(422);

    app(Tenancy::class)->run($tenantA->id, function () use ($survivorA) {
        expect($survivorA->fresh()?->merged_into_patient_id)->toBeNull();
    });
});

it('audits the merge with identifiers and counts, never names', function () {
    [$tenant, $survivor, $duplicate] = mergePair();
    $frontDesk = mergeStaff($tenant, ClinicalRole::FrontDesk);

    $this->actingAs($frontDesk)
        ->postJson(mergeUrl($tenant, "/api/v1/patients/{$survivor->id}/merge"), [
            'duplicate_patient_id' => $duplicate->id,
        ])
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($survivor, $duplicate) {
        $event = AuditEvent::query()
            ->where('action', 'patient.merged')
            ->where('subject_id', $survivor->id)
            ->firstOrFail();

        /** @var array<string, mixed> $metadata */
        $metadata = $event->getAttribute('metadata');
        $encoded = (string) json_encode($metadata);

        expect($metadata['merged_patient_id'])->toBe($duplicate->id)
            // How many records moved is an outcome. Who the person is, is not.
            ->and($encoded)->not->toContain($duplicate->family_name)
            ->and($encoded)->not->toContain($duplicate->phone);
    });
});
