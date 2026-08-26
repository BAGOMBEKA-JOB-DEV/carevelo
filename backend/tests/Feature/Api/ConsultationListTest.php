<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\ConsultationOutcome;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| GET /v1/consultations -- the encounters already held
|--------------------------------------------------------------------------
|
| The route was registered `->only(['store', 'show'])`, so a clinician could
| start a consultation and open one they already knew the id of, and could not
| ask what they had seen last week. Nothing in the product could show a history.
|
| Three things are load-bearing here and each has its own test:
|
|   1. the same policy as the sibling reads -- clinician and clinic_admin see
|      the clinic's encounters, a patient sees their own and nobody else's,
|      front desk and the pharmacist see none;
|   2. CURSOR pagination, which the conventions require, because a list paged
|      through while consultations are being held shifts under an offset and a
|      skipped row is an encounter that appears never to have happened;
|   3. the read is AUDITED, like every other read of a clinical record --
|      "who looked at my records?" is only answerable if every look was written
|      down.
|
| Patient-to-patient isolation for this endpoint lives with the other mandatory
| isolation tests, in PatientOwnAccessTest.
|
| @see docs/40-api/api-conventions.md
| @see docs/50-security-compliance/rbac-matrix.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function consultationListUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function consultationListStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A clinic with two clinicians, two patients and four consultations spread
 * across four days.
 *
 * @return array{
 *     tenant: Tenant,
 *     clinicianUser: User,
 *     clinicianA: Clinician,
 *     clinicianB: Clinician,
 *     patientA: Patient,
 *     patientB: Patient,
 *     consultations: list<Consultation>,
 * }
 */
function consultationHistory(): array
{
    $tenant = Tenant::factory()->create();

    $clinicianUser = consultationListStaff($tenant, ClinicalRole::Clinician);

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $clinicianUser) {
        $clinicianA = Clinician::factory()->create(['user_id' => $clinicianUser->id]);
        $clinicianB = Clinician::factory()->create();

        $patientA = Patient::factory()->create();
        $patientB = Patient::factory()->create();

        $held = function (Clinician $clinician, Patient $patient, int $daysAgo, ?ConsultationOutcome $outcome) {
            return Consultation::factory()->create([
                'clinician_id' => $clinician->id,
                'patient_id' => $patient->id,
                'started_at' => Date::now()->subDays($daysAgo),
                'ended_at' => Date::now()->subDays($daysAgo)->addMinutes(20),
                'outcome' => $outcome,
            ]);
        };

        return [
            'tenant' => $tenant,
            'clinicianUser' => $clinicianUser,
            'clinicianA' => $clinicianA,
            'clinicianB' => $clinicianB,
            'patientA' => $patientA,
            'patientB' => $patientB,
            'consultations' => [
                $held($clinicianA, $patientA, 1, ConsultationOutcome::Completed),
                $held($clinicianA, $patientB, 3, ConsultationOutcome::PatientNoShow),
                $held($clinicianB, $patientA, 5, ConsultationOutcome::Completed),
                $held($clinicianB, $patientB, 9, ConsultationOutcome::ConvertedToInPerson),
            ],
        ];
    });
}

/**
 * The `id` of every row in a decoded list body, in order.
 *
 * @return list<string>
 */
function consultationListIds(mixed $rows): array
{
    $ids = [];

    foreach (is_array($rows) ? $rows : [] as $row) {
        if (is_array($row) && is_string($row['id'] ?? null)) {
            $ids[] = $row['id'];
        }
    }

    return $ids;
}

// --- The listing ----------------------------------------------------------

it('lists the clinic\'s consultations, most recent first', function () {
    $f = consultationHistory();

    $ids = consultationListIds(
        $this->actingAs($f['clinicianUser'])
            ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations'))
            ->assertOk()
            ->json('data')
    );

    // Newest first is the default because "what happened recently" is the
    // question the list is opened to answer.
    expect($ids)->toBe(array_map(
        static fn (Consultation $consultation): string => $consultation->id,
        $f['consultations'],
    ));
});

it('sorts oldest first when asked', function () {
    $f = consultationHistory();

    $ids = consultationListIds(
        $this->actingAs($f['clinicianUser'])
            ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations?sort=started_at'))
            ->assertOk()
            ->json('data')
    );

    expect($ids)->toBe(array_reverse(array_map(
        static fn (Consultation $consultation): string => $consultation->id,
        $f['consultations'],
    )));
});

it('filters by patient, clinician, outcome and date window', function () {
    $f = consultationHistory();
    $url = fn (string $query): string => consultationListUrl($f['tenant'], '/api/v1/consultations?'.$query);

    $ask = fn (string $query): array => consultationListIds(
        $this->actingAs($f['clinicianUser'])->getJson($url($query))->assertOk()->json('data')
    );

    expect($ask('patient_id='.$f['patientA']->id))
        ->toBe([$f['consultations'][0]->id, $f['consultations'][2]->id]);

    expect($ask('clinician_id='.$f['clinicianB']->id))
        ->toBe([$f['consultations'][2]->id, $f['consultations'][3]->id]);

    expect($ask('outcome='.ConsultationOutcome::Completed->value))
        ->toBe([$f['consultations'][0]->id, $f['consultations'][2]->id]);

    // `to` covers the whole of the day named, not midnight at the start of it.
    expect($ask('from='.Date::now()->subDays(5)->toDateString().'&to='.Date::now()->subDays(3)->toDateString()))
        ->toBe([$f['consultations'][1]->id, $f['consultations'][2]->id]);
});

it('rejects a filter or sort the endpoint does not define', function () {
    $f = consultationHistory();

    $this->actingAs($f['clinicianUser'])
        ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations?sort=outcome'))
        ->assertStatus(422);

    // A query assembled from arbitrary client input is SQL injection wearing a
    // REST costume.
    $this->actingAs($f['clinicianUser'])
        ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations?tenant_id=whatever'))
        ->assertStatus(422);
});

it('pages with an opaque cursor rather than an offset', function () {
    $f = consultationHistory();

    $first = $this->actingAs($f['clinicianUser'])
        ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations?per_page=2'))
        ->assertOk();

    expect(consultationListIds($first->json('data')))->toHaveCount(2);

    $cursor = $first->json('meta.next_cursor');

    expect($cursor)->toBeString();

    $second = $this->actingAs($f['clinicianUser'])
        ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations?per_page=2&cursor='.$cursor))
        ->assertOk();

    // No row appears twice and none is skipped, which is the whole reason the
    // conventions forbid offsets here.
    expect(array_merge(consultationListIds($first->json('data')), consultationListIds($second->json('data'))))
        ->toBe(array_map(
            static fn (Consultation $consultation): string => $consultation->id,
            $f['consultations'],
        ));

    // There is no page number to guess at, and no total to leak a count from.
    expect($first->json('meta.current_page'))->toBeNull();
});

it('carries no clinical content in the list', function () {
    $f = consultationHistory();

    $body = strtolower((string) json_encode(
        $this->actingAs($f['clinicianUser'])
            ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations'))
            ->assertOk()
            ->json()
    ));

    foreach (['diagnosis', 'body', 'note', 'medicine'] as $term) {
        expect(str_contains($body, $term))->toBeFalse("Consultation list leaked '{$term}'");
    }
});

// --- Who may read it ------------------------------------------------------

it('lets an administrator read the clinic\'s consultations, and audits it', function () {
    // An administrator of a small clinic genuinely needs this. Every such read
    // is audited, which is the condition the matrix attaches to it.
    $f = consultationHistory();
    $admin = consultationListStaff($f['tenant'], ClinicalRole::ClinicAdmin);

    $this->actingAs($admin)
        ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations'))
        ->assertOk()
        ->assertJsonCount(4, 'data');

    app(Tenancy::class)->run($f['tenant']->id, function () {
        $event = AuditEvent::query()->where('action', 'consultation.list_read')->first();

        expect($event)->not->toBeNull();
        expect(((array) $event?->metadata)['returned'] ?? null)->toBe(4);
    });
});

it('refuses the list to a role with no business in the encounter', function (string $role) {
    // Front desk books appointments and never opens the encounter behind one;
    // a pharmacist reaches what they need through the dispense order; a rider
    // and a dispatcher have no clinical reach at all.
    $f = consultationHistory();
    $actor = consultationListStaff($f['tenant'], ClinicalRole::from($role));

    $this->actingAs($actor)
        ->getJson(consultationListUrl($f['tenant'], '/api/v1/consultations'))
        ->assertForbidden();
})->with([
    ClinicalRole::FrontDesk->value,
    ClinicalRole::Pharmacist->value,
    ClinicalRole::Dispatcher->value,
    ClinicalRole::Rider->value,
]);

it('shows a clinic none of another clinic\'s consultations', function () {
    $f = consultationHistory();

    $otherClinic = Tenant::factory()->create();
    $stranger = consultationListStaff($otherClinic, ClinicalRole::Clinician);

    app(Tenancy::class)->run($otherClinic->id, fn () => Consultation::factory()->create());

    $ids = consultationListIds(
        $this->actingAs($stranger)
            ->getJson(consultationListUrl($otherClinic, '/api/v1/consultations'))
            ->assertOk()
            ->json('data')
    );

    expect($ids)->toHaveCount(1);

    foreach ($f['consultations'] as $consultation) {
        expect($ids)->not->toContain($consultation->id);
    }
});
