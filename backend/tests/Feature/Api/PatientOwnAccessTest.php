<?php

use App\Http\Controllers\Api\V1\PaymentIntentController;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\ClinicalRole;
use App\Models\Consultation;
use App\Models\Delivery;
use App\Models\DispenseOrder;
use App\Models\OutboundNotification;
use App\Models\Patient;
use App\Models\PaymentIntent;
use App\Models\Prescription;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| Mandatory test -- patient-to-patient isolation
|--------------------------------------------------------------------------
|
| The endpoints the catalogue marks `P own`, checked from the only angle that
| matters: can one patient of a clinic reach another patient of the SAME clinic.
|
| ROW-LEVEL SECURITY CANNOT HELP HERE. Both patients' rows carry the same
| tenant_id, so the database is perfectly satisfied to return either. Every other
| isolation test in this suite leans on RLS as the backstop behind the
| application; this one has no backstop. Authorisation is the entire control.
|
| Both halves are tested for every endpoint, because they fail differently:
|
|   SHOW  is guarded by a policy, and a policy that forgets the patient path
|         refuses a patient their own records -- annoying, visible, quickly fixed.
|
|   INDEX is guarded by a WHERE clause, and an index that authorises the patient
|         but forgets to narrow returns EVERY patient in the clinic. Nothing
|         refuses it, nothing logs it, and the response looks entirely normal to
|         the client. This is the dangerous one, and it is why the narrowing lives
|         inside the same call as the authorisation.
|
| @see docs/50-security-compliance/rbac-matrix.md
| @see app/Http/Controllers/Api/V1/Concerns/AuthorisesPatientReads.php
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function ownUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * One clinic, two patients, each with their own account and their own records.
 *
 * @return array{tenant: Tenant, userA: User, userB: User, patientA: Patient, patientB: Patient}
 */
function twoPatientsOfOneClinic(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $make = function (string $phone) use ($tenant): array {
            $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => $phone]);
            $user->assignRole(ClinicalRole::Patient->value);

            $patient = Patient::factory()->create(['phone' => $phone]);
            $patient->user_id = $user->id;
            $patient->save();

            return [$user, $patient];
        };

        [$userA, $patientA] = $make('+256772000101');
        [$userB, $patientB] = $make('+256772000202');

        return [
            'tenant' => $tenant,
            'userA' => $userA,
            'userB' => $userB,
            'patientA' => $patientA,
            'patientB' => $patientB,
        ];
    });
}

// --- Appointments ----------------------------------------------------------

it('shows a patient their own appointment and refuses another patient theirs', function () {
    $f = twoPatientsOfOneClinic();

    [$mine, $theirs] = app(Tenancy::class)->run($f['tenant']->id, fn () => [
        Appointment::factory()->create(['patient_id' => $f['patientA']->id]),
        Appointment::factory()->create(['patient_id' => $f['patientB']->id]),
    ]);

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/appointments/'.$mine->id))
        ->assertOk();

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/appointments/'.$theirs->id))
        ->assertForbidden();
});

it('lists a patient only their own appointments', function () {
    // The leak that a per-row policy cannot catch.
    $f = twoPatientsOfOneClinic();

    [$mine, $theirs] = app(Tenancy::class)->run($f['tenant']->id, fn () => [
        Appointment::factory()->create(['patient_id' => $f['patientA']->id]),
        Appointment::factory()->create(['patient_id' => $f['patientB']->id]),
    ]);

    $ids = collect((array) $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/appointments'))
        ->assertOk()
        ->json('data'))->pluck('id');

    expect($ids)->toContain($mine->id)
        ->and($ids)->not->toContain($theirs->id);
});

it('lets a patient cancel their own appointment but not another patient\'s', function () {
    $f = twoPatientsOfOneClinic();

    [$mine, $theirs] = app(Tenancy::class)->run($f['tenant']->id, fn () => [
        Appointment::factory()->create([
            'patient_id' => $f['patientA']->id,
            'status' => AppointmentStatus::Confirmed,
        ]),
        Appointment::factory()->create([
            'patient_id' => $f['patientB']->id,
            'status' => AppointmentStatus::Confirmed,
        ]),
    ]);

    $this->actingAs($f['userA'])
        ->postJson(ownUrl($f['tenant'], '/api/v1/appointments/'.$theirs->id.'/cancel'), [
            'reason' => 'Not mine to cancel',
        ])
        ->assertForbidden();

    $this->actingAs($f['userA'])
        ->postJson(ownUrl($f['tenant'], '/api/v1/appointments/'.$mine->id.'/cancel'), [
            'reason' => 'Cannot attend',
        ])
        ->assertOk();
});

// --- Consultations, prescriptions and the document -------------------------

it('refuses a patient another patient\'s consultation', function () {
    $f = twoPatientsOfOneClinic();

    $theirs = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Consultation::factory()->create(['patient_id' => $f['patientB']->id])
    );

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/consultations/'.$theirs->id))
        ->assertForbidden();
});

it('lists a patient only their own prescriptions', function () {
    $f = twoPatientsOfOneClinic();

    [$mine, $theirs] = app(Tenancy::class)->run($f['tenant']->id, fn () => [
        Prescription::factory()->create(['patient_id' => $f['patientA']->id]),
        Prescription::factory()->create(['patient_id' => $f['patientB']->id]),
    ]);

    $ids = collect((array) $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/prescriptions'))
        ->assertOk()
        ->json('data'))->pluck('id');

    expect($ids)->toContain($mine->id)
        ->and($ids)->not->toContain($theirs->id);
});

it('ignores a patient_id filter naming another patient', function () {
    // The filter intersects with the narrowing rather than replacing it, so
    // asking for someone else's records returns nothing instead of theirs.
    $f = twoPatientsOfOneClinic();

    app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Prescription::factory()->create(['patient_id' => $f['patientB']->id])
    );

    $data = $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/prescriptions?patient_id='.$f['patientB']->id))
        ->assertOk()
        ->json('data');

    expect($data)->toBeEmpty();
});

it('refuses a patient another patient\'s prescription document', function () {
    $f = twoPatientsOfOneClinic();

    $theirs = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => Prescription::factory()->create(['patient_id' => $f['patientB']->id])
    );

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/prescriptions/'.$theirs->id.'/document'))
        ->assertForbidden();
});

// --- Dispensing, fulfilment and delivery tracking --------------------------

it('refuses a patient another patient\'s dispense order', function () {
    $f = twoPatientsOfOneClinic();

    $theirs = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => DispenseOrder::factory()->create(['patient_id' => $f['patientB']->id])
    );

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/dispense-orders/'.$theirs->id))
        ->assertForbidden();
});

it('refuses a patient the fulfilment choice on another patient\'s order', function () {
    // Pickup or delivery is the patient's own choice -- of their OWN medicine.
    // Setting it on someone else's order would redirect their medication.
    $f = twoPatientsOfOneClinic();

    $theirs = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => DispenseOrder::factory()->create(['patient_id' => $f['patientB']->id])
    );

    $this->actingAs($f['userA'])
        ->postJson(ownUrl($f['tenant'], '/api/v1/dispense-orders/'.$theirs->id.'/fulfilment'), [
            'method' => 'pickup',
        ])
        ->assertForbidden();
});

it('refuses a patient tracking on another patient\'s delivery', function () {
    $f = twoPatientsOfOneClinic();

    $theirs = app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $order = DispenseOrder::factory()->create(['patient_id' => $f['patientB']->id]);

        return Delivery::factory()->create(['dispense_order_id' => $order->id]);
    });

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/deliveries/'.$theirs->id.'/tracking'))
        ->assertForbidden();
});

it('lets a patient track their own delivery', function () {
    $f = twoPatientsOfOneClinic();

    $mine = app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $order = DispenseOrder::factory()->create(['patient_id' => $f['patientA']->id]);

        return Delivery::factory()->create(['dispense_order_id' => $order->id]);
    });

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/deliveries/'.$mine->id.'/tracking'))
        ->assertOk()
        // Milestones and statuses only. The catalogue is explicit that tracking
        // never carries contents, and a delivery hangs off an order of medicines.
        ->assertJsonMissingPath('data.recipient_name')
        ->assertJsonMissingPath('data.address_text');
});

// --- Payments --------------------------------------------------------------

it('refuses a patient another patient\'s payment attempt and receipt', function () {
    $f = twoPatientsOfOneClinic();

    $theirs = app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $appointment = Appointment::factory()->create(['patient_id' => $f['patientB']->id]);

        return PaymentIntent::factory()->create([
            'payable_type' => 'appointment',
            'payable_id' => $appointment->id,
        ]);
    });

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/payment-intents/'.$theirs->id))
        ->assertForbidden();

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/payment-intents/'.$theirs->id.'/receipt'))
        ->assertForbidden();
});

it('lets a patient read their own payment attempt', function () {
    $f = twoPatientsOfOneClinic();

    $mine = app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        $appointment = Appointment::factory()->create(['patient_id' => $f['patientA']->id]);

        return PaymentIntent::factory()->create([
            'payable_type' => 'appointment',
            'payable_id' => $appointment->id,
        ]);
    });

    $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/payment-intents/'.$mine->id))
        ->assertOk();
});

it('covers every payable type the API accepts', function () {
    // A payable type the API accepts but PATIENT_OWNED_PAYABLES omits does not
    // leak -- the patient simply never sees those intents, including a receipt
    // they are entitled to. Silent and in the safe direction, which is exactly
    // the kind of gap that survives review.
    $rules = (new ReflectionClass(PaymentIntentController::class))
        ->getFileName();

    $source = (string) file_get_contents((string) $rules);

    preg_match("/'payable_type' => \['required', 'in:([^']+)'\]/", $source, $matches);

    // If the rule is reworded this finds nothing, and the test fails rather than
    // silently asserting that an empty list matches an empty list.
    $rule = $matches[1] ?? '';

    expect($rule)->not->toBe('', 'the payable_type validation rule moved -- update this test');

    $accepted = explode(',', $rule);

    expect(array_keys(PaymentIntent::PATIENT_OWNED_PAYABLES))
        ->toEqualCanonicalizing($accepted);
});

// --- Notifications ---------------------------------------------------------

it('lists a patient only notifications sent to their own number', function () {
    $f = twoPatientsOfOneClinic();

    app(Tenancy::class)->run($f['tenant']->id, function () use ($f) {
        OutboundNotification::factory()->create(['recipient' => (string) $f['patientA']->phone]);
        OutboundNotification::factory()->create(['recipient' => (string) $f['patientB']->phone]);
    });

    $recipients = collect((array) $this->actingAs($f['userA'])
        ->getJson(ownUrl($f['tenant'], '/api/v1/notifications'))
        ->assertOk()
        ->json('data'))->pluck('recipient');

    expect($recipients)->not->toBeEmpty()
        ->and($recipients->filter(fn (mixed $r) => str_contains((string) $r, '202')))->toBeEmpty();
});

// --- The account that owns nothing -----------------------------------------

it('shows nothing to a patient account with no records linked', function () {
    // A brand-new account before it has claimed anything. whereIn against an
    // empty list must narrow to nothing rather than to everything.
    $tenant = Tenant::factory()->create();

    $orphan = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::Patient->value);

        Appointment::factory()->create();
        Prescription::factory()->create();

        return $user;
    });

    expect($this->actingAs($orphan)
        ->getJson(ownUrl($tenant, '/api/v1/appointments'))
        ->assertOk()
        ->json('data'))->toBeEmpty();

    expect($this->actingAs($orphan)
        ->getJson(ownUrl($tenant, '/api/v1/prescriptions'))
        ->assertOk()
        ->json('data'))->toBeEmpty();
});
