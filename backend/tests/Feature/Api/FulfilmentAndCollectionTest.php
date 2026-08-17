<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Factories\ConsentRecordFactory;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| H4 §4 — pickup or delivery, and collection at the counter
|--------------------------------------------------------------------------
|
| The two endpoints that decide how medicine leaves the pharmacy. Both were
| bound in routes/api.php with no method behind them, so every request to either
| was a 500 — which is why the refusals below are the point of this file rather
| than the happy paths.
|
| Three refusals matter regulatorily and each has its own test:
|
|   - a controlled item can never be delivered (NDPA Act Cap 206);
|   - an address never reaches a rider without delivery_disclosure consent
|     (DPPA 2019), and the answer given here must match the one dispatch gives;
|   - an order set for delivery is not "collected", because a rider still has it.
|
| Every fixture and every assertion runs inside Tenancy::run(). Outside it,
| row-level security correctly hides the rows and an assertion would pass by
| seeing nothing at all.
|
| @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function ffUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function ffStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A dispensed order, ready for the patient to choose how to receive it.
 *
 * `dispensed` rather than `received`: both endpoints under test act at or after
 * the point a pharmacist has actually filled the order, and starting earlier
 * would test the state machine instead of these methods.
 *
 * @return array{Tenant, DispenseOrder, Patient}
 */
function ffOrder(bool $controlled = false): array
{
    $tenant = Tenant::factory()->create();
    $clinicianUser = ffStaff($tenant, ClinicalRole::Clinician);

    [$order, $patient] = app(Tenancy::class)->run($tenant->id, function () use ($clinicianUser, $controlled) {
        $clinician = Clinician::factory()->create(['user_id' => $clinicianUser->id]);
        $patient = Patient::factory()->create();

        $prescription = Prescription::factory()->create([
            'patient_id' => $patient->id,
            'clinician_id' => $clinician->id,
        ]);

        $item = PrescriptionItem::factory();

        ($controlled ? $item->controlled() : $item)->create([
            'prescription_id' => $prescription->id,
        ]);

        $order = DispenseOrder::factory()->create([
            'prescription_id' => $prescription->id,
            'patient_id' => $patient->id,
            'status' => DispenseOrderStatus::Dispensed,
        ]);

        return [$order, $patient];
    });

    return [$tenant, $order, $patient];
}

/** Consent as ConsentController would have written it, at the point delivery was chosen. */
function ffGrantDeliveryConsent(Tenant $tenant, Patient $patient, string $action = 'granted'): void
{
    app(Tenancy::class)->run($tenant->id, function () use ($patient, $action) {
        ConsentRecordFactory::new()->deliveryDisclosure()->create([
            'patient_id' => $patient->id,
            'action' => $action,
        ]);
    });
}

it('records a pickup choice and readies the order for collection', function () {
    [$tenant, $order] = ffOrder();
    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'pickup'])
        ->assertOk()
        ->assertJsonPath('data.fulfilment', 'pickup')
        // The medicine is on the shelf with the patient's name on it. That is
        // what ready_for_pickup means, so choosing pickup on a dispensed order
        // reaches it rather than waiting for a second call.
        ->assertJsonPath('data.status', DispenseOrderStatus::ReadyForPickup->value);
});

it('records a delivery choice once the patient has consented to disclosure', function () {
    [$tenant, $order, $patient] = ffOrder();
    ffGrantDeliveryConsent($tenant, $patient);

    $frontDesk = ffStaff($tenant, ClinicalRole::FrontDesk);

    $this->actingAs($frontDesk)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'delivery'])
        ->assertOk()
        ->assertJsonPath('data.fulfilment', 'delivery')
        // Still dispensed. Leaving the pharmacy needs a Delivery record and a
        // rider, which is the dispatch board's job, not this endpoint's.
        ->assertJsonPath('data.status', DispenseOrderStatus::Dispensed->value);
});

it('refuses delivery of a controlled medicine, with no override', function () {
    // NDPA Act Cap 206. Refused at the counter while the patient is still
    // standing there, rather than after they have gone home to wait.
    [$tenant, $order, $patient] = ffOrder(controlled: true);

    // Consent granted, so the refusal below can only be about the medicine.
    ffGrantDeliveryConsent($tenant, $patient);

    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'delivery'])
        ->assertStatus(409);

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect($order->fresh()?->fulfilment)->toBeNull();
    });
});

it('refuses delivery without delivery_disclosure consent', function () {
    [$tenant, $order] = ffOrder();
    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'delivery'])
        ->assertStatus(409);
});

it('refuses delivery once consent has been withdrawn', function () {
    // Withdrawal is a NEW record, so the latest one decides. An earlier grant
    // must not survive it.
    [$tenant, $order, $patient] = ffOrder();
    ffGrantDeliveryConsent($tenant, $patient, 'granted');
    ffGrantDeliveryConsent($tenant, $patient, 'withdrawn');

    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'delivery'])
        ->assertStatus(409);
});

it('requires a method, and accepts only pickup or delivery', function () {
    // No default. A default of `delivery` would be a guess that the patient's
    // address may be shared with a rider.
    [$tenant, $order] = ffOrder();
    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), [])
        ->assertStatus(422)
        ->assertJsonPath('errors.method.0', 'The method field is required.');

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'courier'])
        ->assertStatus(422);
});

it('refuses a fulfilment choice from a rider', function () {
    [$tenant, $order] = ffOrder();
    $rider = ffStaff($tenant, ClinicalRole::Rider);

    $this->actingAs($rider)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'pickup'])
        ->assertForbidden();
});

it('records the method in the audit trail and never the address', function () {
    [$tenant, $order, $patient] = ffOrder();
    ffGrantDeliveryConsent($tenant, $patient);

    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'delivery'])
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($order, $patient) {
        $event = AuditEvent::query()
            ->where('action', 'dispense_order.fulfilment_chosen')
            ->where('subject_id', $order->id)
            ->firstOrFail();

        /** @var array<string, mixed> $metadata */
        $metadata = $event->getAttribute('metadata');

        // An allow-list, not a search for known-bad strings. The address is
        // absent because these two keys are ALL there is -- a test that only
        // grepped for today's fields would pass the day a third one appears.
        expect(array_keys($metadata))->toEqualCanonicalizing(['method', 'status'])
            ->and($metadata['method'])->toBe('delivery');

        $encoded = (string) json_encode($metadata);

        // Where someone lives, and how to ring them, is not an audit event's
        // business even when the event is about delivering to them.
        expect($encoded)->not->toContain($patient->phone)
            ->and($encoded)->not->toContain($patient->family_name);
    });
});

it('completes a pickup at the counter', function () {
    [$tenant, $order] = ffOrder();
    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'pickup'])
        ->assertOk();

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/collect"))
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::Collected->value);
});

it('collects a dispensed order that was never explicitly readied', function () {
    // ready_for_pickup is a shelf state. A pharmacist who dispensed and handed
    // over in one motion did two steps at once rather than skipping one, and the
    // state machine still records both.
    [$tenant, $order] = ffOrder();
    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/collect"))
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::Collected->value);
});

it('refuses to collect an order that is out for delivery', function () {
    // A rider is holding the package. Closing the order here would silence the
    // tracking the patient is watching while their medicines are still moving.
    [$tenant, $order, $patient] = ffOrder();
    ffGrantDeliveryConsent($tenant, $patient);

    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/fulfilment"), ['method' => 'delivery'])
        ->assertOk();

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/collect"))
        ->assertStatus(409);
});

it('refuses to collect an order the pharmacy has not dispensed', function () {
    [$tenant, $order] = ffOrder();

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        $order->status = DispenseOrderStatus::AwaitingPayment;
        $order->save();
    });

    $pharmacist = ffStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/collect"))
        ->assertStatus(409);
});

it('lets only a pharmacist hand medicine over', function () {
    // Same rule as dispensing: this is the moment medicine physically leaves the
    // clinic's pharmacy, and it is attributable to licensed staff.
    [$tenant, $order] = ffOrder();
    $admin = ffStaff($tenant, ClinicalRole::ClinicAdmin);

    $this->actingAs($admin)
        ->postJson(ffUrl($tenant, "/api/v1/dispense-orders/{$order->id}/collect"))
        ->assertForbidden();
});

it('returns 404 not 403 for an order in another clinic', function () {
    // A 403 would confirm the order exists, and therefore that a given person is
    // a patient of some other clinic. The intruder reaches their OWN host, so
    // row-level security is bound to their tenant and the row is not there.
    [, $orderA] = ffOrder();
    [$tenantB] = ffOrder();

    $pharmacistOfB = ffStaff($tenantB, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacistOfB)
        ->postJson(ffUrl($tenantB, "/api/v1/dispense-orders/{$orderA->id}/fulfilment"), ['method' => 'pickup'])
        ->assertNotFound();

    $this->actingAs($pharmacistOfB)
        ->postJson(ffUrl($tenantB, "/api/v1/dispense-orders/{$orderA->id}/collect"))
        ->assertNotFound();
});
