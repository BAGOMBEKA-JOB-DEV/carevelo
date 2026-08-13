<?php

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\ConsentRecord;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Factories\DeliveryEventFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| H4 §5 — delivery dispatch
|--------------------------------------------------------------------------
|
| The exception paths are the product here. A controlled item that reaches a
| rider, an address disclosed without consent, or a failed delivery that quietly
| closes are each a regulatory failure rather than a bug, so each has a test of
| its own below.
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

afterEach(function () {
    Date::setTestNow();
});

function dispatchUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function dispatchStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * Record the patient's decision about their address reaching a rider.
 *
 * Withdrawal is a NEW record, never an edit, which is why the caller controls
 * the timestamp: the latest record is the one that decides.
 */
function dispatchConsent(Patient $patient, string $action = 'granted', ?Carbon $occurredAt = null): ConsentRecord
{
    return ConsentRecord::create([
        'patient_id' => $patient->id,
        'consent_type' => 'delivery_disclosure',
        'policy_version' => '2026-01',
        'policy_text_hash' => hash('sha256', 'delivery disclosure v2026-01'),
        'action' => $action,
        'granted_by' => 'patient',
        'occurred_at' => $occurredAt ?? Date::now(),
    ]);
}

/**
 * A dispensed order sitting in the pharmacy, ready to leave.
 *
 * @return array{Tenant, DispenseOrder, Patient}
 */
function dispatchFixture(bool $controlled = false, bool $consented = true): array
{
    $tenant = Tenant::factory()->create();

    [$order, $patient] = app(Tenancy::class)->run($tenant->id, function () use ($controlled, $consented) {
        $patient = Patient::factory()->create();
        $prescription = Prescription::factory()->create(['patient_id' => $patient->id]);

        $item = PrescriptionItem::factory();
        ($controlled ? $item->controlled() : $item)->create(['prescription_id' => $prescription->id]);

        $order = DispenseOrder::factory()->create([
            'prescription_id' => $prescription->id,
            'patient_id' => $patient->id,
            'status' => DispenseOrderStatus::Dispensed,
        ]);

        if ($consented) {
            dispatchConsent($patient);
        }

        return [$order, $patient];
    });

    return [$tenant, $order, $patient];
}

function dispatchDelivery(Tenant $tenant, DispenseOrder $order): Delivery
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn () => Delivery::factory()->create(['dispense_order_id' => $order->id])
    );
}

/** @return array<string, string> */
function dispatchBody(DispenseOrder $order): array
{
    return [
        'dispense_order_id' => $order->id,
        'recipient_name' => 'Aisha Nakato',
        'recipient_phone' => '0772 123 456',
        'address_text' => 'Plot 14, Bugolobi',
        'district' => 'Kampala',
        'landmark' => 'Opposite the Shell station',
    ];
}

it('shows the dispatch board to a dispatcher', function () {
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);

    dispatchDelivery($tenant, $order);

    $this->actingAs($dispatcher)
        ->getJson(dispatchUrl($tenant, '/api/v1/deliveries'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.status', DeliveryStatus::Unassigned->value);
});

it('keeps the dispatch board away from riders', function () {
    // The board is every recipient and every address in the clinic at once.
    [$tenant] = dispatchFixture();
    $rider = dispatchStaff($tenant, ClinicalRole::Rider);

    $this->actingAs($rider)
        ->getJson(dispatchUrl($tenant, '/api/v1/deliveries'))
        ->assertForbidden();
});

it('dispatches a dispensed order', function () {
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, '/api/v1/deliveries'), dispatchBody($order))
        ->assertCreated()
        ->assertJsonPath('data.status', DeliveryStatus::Unassigned->value)
        // Normalised to E.164 at the boundary: a rider dialling a number
        // written six different ways is a failed delivery.
        ->assertJsonPath('data.recipient_phone', '+256772123456');

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect(Delivery::query()->count())->toBe(1)
            ->and($order->refresh()->status)->toBe(DispenseOrderStatus::OutForDelivery);
    });
});

it('refuses to dispatch an order the pharmacy has not dispensed', function () {
    // Nothing leaves the pharmacy before a named pharmacist has handed it over.
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        $order->status = DispenseOrderStatus::Paid;
        $order->save();
    });

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, '/api/v1/deliveries'), dispatchBody($order))
        ->assertStatus(409);

    app(Tenancy::class)->run($tenant->id, fn () => expect(Delivery::query()->count())->toBe(0));
});

it('refuses to dispatch an order containing a controlled item, and writes no delivery', function () {
    // NDPA Act Cap 206. Controlled items are flagged for in-person handling and
    // are excluded from the delivery flow entirely. There is no override, and
    // the system offers the clinic no way to ask for one.
    [$tenant, $order] = dispatchFixture(controlled: true);
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, '/api/v1/deliveries'), dispatchBody($order))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        // Nothing was written: not a delivery in a refused state, not a row for
        // a later sweep to pick up. Nothing.
        expect(Delivery::query()->count())->toBe(0)
            ->and($order->refresh()->status)->toBe(DispenseOrderStatus::Dispensed);
    });
});

it('refuses to dispatch without delivery_disclosure consent', function () {
    // The address IS the disclosure. Consent for it is captured at the point
    // delivery is chosen, and no address is prepared for a rider without it.
    [$tenant, $order] = dispatchFixture(consented: false);
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, '/api/v1/deliveries'), dispatchBody($order))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    app(Tenancy::class)->run($tenant->id, fn () => expect(Delivery::query()->count())->toBe(0));
});

it('refuses to assign a rider after consent is withdrawn', function () {
    // Consent granted at dispatch does not survive a withdrawal made before the
    // rider was chosen. Assignment is the moment an address actually reaches a
    // person, so the check is repeated there.
    [$tenant, $order, $patient] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $rider = dispatchStaff($tenant, ClinicalRole::Rider);
    $delivery = dispatchDelivery($tenant, $order);

    app(Tenancy::class)->run(
        $tenant->id,
        fn () => dispatchConsent($patient, 'withdrawn', Date::now()->addHour())
    );

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/assign"), [
            'rider_id' => $rider->id,
        ])
        ->assertStatus(409);

    app(Tenancy::class)->run($tenant->id, function () use ($delivery) {
        expect($delivery->refresh()->rider_id)->toBeNull()
            ->and($delivery->status)->toBe(DeliveryStatus::Unassigned);
    });
});

it('assigns a rider', function () {
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $rider = dispatchStaff($tenant, ClinicalRole::Rider);
    $delivery = dispatchDelivery($tenant, $order);

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/assign"), [
            'rider_id' => $rider->id,
        ])
        ->assertOk()
        ->assertJsonPath('data.status', DeliveryStatus::Assigned->value)
        ->assertJsonPath('data.rider_id', $rider->id);
});

it('refuses to let a rider assign work', function () {
    // DeliveryPolicy::assign — dispatcher and administrator only. A rider does
    // not hand out work, to themselves or to anyone else.
    [$tenant, $order] = dispatchFixture();
    $rider = dispatchStaff($tenant, ClinicalRole::Rider);
    $delivery = dispatchDelivery($tenant, $order);

    $this->actingAs($rider)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/assign"), [
            'rider_id' => $rider->id,
        ])
        ->assertForbidden();
});

it('refuses to assign someone who is not a rider of this clinic', function () {
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $riderElsewhere = dispatchStaff(Tenant::factory()->create(), ClinicalRole::Rider);
    $delivery = dispatchDelivery($tenant, $order);

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/assign"), [
            'rider_id' => $riderElsewhere->id,
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('keeps the original assignment in the event history when reassigning', function () {
    // A rider goes unreachable mid-delivery and the dispatcher hands the job on.
    // Standing the first rider down is itself a recorded transition, so the
    // original assignment survives rather than being overwritten.
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $first = dispatchStaff($tenant, ClinicalRole::Rider);
    $second = dispatchStaff($tenant, ClinicalRole::Rider);
    $delivery = dispatchDelivery($tenant, $order);

    app(Tenancy::class)->run($tenant->id, fn () => $delivery->assignTo($first->id));

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/assign"), [
            'rider_id' => $second->id,
        ])
        ->assertOk()
        ->assertJsonPath('data.rider_id', $second->id);

    app(Tenancy::class)->run($tenant->id, function () use ($delivery) {
        $events = $delivery->events()->get();

        expect($events)->toHaveCount(3)
            ->and($events->where('to_status', DeliveryStatus::Assigned->value))->toHaveCount(2)
            ->and($events->where('to_status', DeliveryStatus::Unassigned->value))->toHaveCount(1);
    });
});

it('returns status milestones only and never names the contents', function () {
    // The tracking view is read on shared phones and over shoulders. It says a
    // package is on its way; it never says what is in it.
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $delivery = dispatchDelivery($tenant, $order);

    app(Tenancy::class)->run($tenant->id, function () use ($delivery) {
        Date::setTestNow(Date::parse('2026-08-13 10:00:00'));
        $delivery->transitionTo(DeliveryStatus::Assigned);

        Date::setTestNow(Date::parse('2026-08-13 10:05:00'));
        $delivery->transitionTo(DeliveryStatus::PickedUp);

        // An operational note on the thread. Free text is where clinical
        // content escapes, so the tracking view must not read that column.
        DeliveryEventFactory::new()->withNote('Amoxicillin 500mg handed to rider')->create([
            'delivery_id' => $delivery->id,
            'from_status' => DeliveryStatus::PickedUp->value,
            'to_status' => DeliveryStatus::EnRoute->value,
            'occurred_at' => Date::parse('2026-08-13 10:10:00'),
        ]);

        Date::setTestNow();
    });

    $response = $this->actingAs($dispatcher)
        ->getJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/tracking"))
        ->assertOk()
        ->assertJsonCount(3, 'data.milestones')
        ->assertJsonPath('data.milestones.0.status', DeliveryStatus::Assigned->value)
        ->assertJsonPath('data.milestones.1.status', DeliveryStatus::PickedUp->value)
        ->assertJsonPath('data.milestones.2.status', DeliveryStatus::EnRoute->value);

    $body = strtolower(json_encode($response->json()) ?: '');

    foreach (['amoxicillin', 'medicine', 'diagnosis', 'prescription', 'dosage', 'directions'] as $term) {
        expect($body)->not->toContain($term, "Tracking payload leaked '{$term}'");
    }

    // Nor the recipient block: tracking answers "where is my package", and an
    // address is no part of that answer.
    foreach (['recipient', 'address', 'landmark'] as $term) {
        expect($body)->not->toContain($term, "Tracking payload leaked '{$term}'");
    }
});

it('accepts only a failure reason from the fixed list', function () {
    // Free text alone cannot be reported on, and "the rider said something"
    // does not tell a clinic whether its addresses or its riders are the
    // problem.
    [$tenant, $order] = dispatchFixture();
    $delivery = dispatchDelivery($tenant, $order);

    app(Tenancy::class)->run($tenant->id, function () use ($delivery) {
        $delivery->assignTo((string) Str::ulid());
        $delivery->transitionTo(DeliveryStatus::PickedUp);
        $delivery->transitionTo(DeliveryStatus::EnRoute);

        expect(fn () => $delivery->fail('the gate was locked'))->toThrow(IllegalTransition::class);

        expect(Delivery::FAILURE_REASONS)->toBe([
            'recipient_unreachable',
            'address_incorrect',
            'refused',
            'rider_unable_to_complete',
        ]);

        // And the refusal left the delivery exactly where it was.
        expect($delivery->refresh()->status)->toBe(DeliveryStatus::EnRoute);
    });
});

it('returns a failed delivery to the pharmacy and never silently closes it', function () {
    // The medicine goes back to the licensed premises. It never sits with a
    // rider overnight, and `failed` is not a resting state.
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $delivery = dispatchDelivery($tenant, $order);

    app(Tenancy::class)->run($tenant->id, function () use ($delivery) {
        $delivery->assignTo((string) Str::ulid());
        $delivery->transitionTo(DeliveryStatus::PickedUp);
        $delivery->transitionTo(DeliveryStatus::EnRoute);
        $delivery->fail('recipient_unreachable');

        // `failed` leads nowhere except back to the pharmacy. There is no
        // transition to delivered and none to a terminal state.
        expect(DeliveryStatus::Failed->allowedTransitions())
            ->toBe([DeliveryStatus::ReturnedToPharmacy]);

        $delivery->transitionTo(DeliveryStatus::ReturnedToPharmacy);
    });

    $this->actingAs($dispatcher)
        ->getJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/tracking"))
        ->assertOk()
        ->assertJsonPath('data.status', DeliveryStatus::ReturnedToPharmacy->value)
        ->assertJsonPath('data.failure_reason', 'recipient_unreachable')
        ->assertJsonPath('data.delivered_at', null);
});

it('sends a returned delivery out again rather than closing it', function () {
    // returned_to_pharmacy → unassigned → assigned. The patient is offered a
    // reschedule, and the reschedule is a real path rather than a promise.
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $rider = dispatchStaff($tenant, ClinicalRole::Rider);
    $delivery = dispatchDelivery($tenant, $order);

    app(Tenancy::class)->run($tenant->id, function () use ($delivery) {
        $delivery->assignTo((string) Str::ulid());
        $delivery->transitionTo(DeliveryStatus::PickedUp);
        $delivery->transitionTo(DeliveryStatus::EnRoute);
        $delivery->fail('address_incorrect');
        $delivery->transitionTo(DeliveryStatus::ReturnedToPharmacy);
    });

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$delivery->id}/assign"), [
            'rider_id' => $rider->id,
        ])
        ->assertOk()
        ->assertJsonPath('data.status', DeliveryStatus::Assigned->value);
});

it('returns 404 not 403 for a delivery in another clinic', function () {
    // A 403 would confirm the delivery exists, and therefore that a given
    // person is a patient of some other clinic.
    [$tenantA, $orderA] = dispatchFixture();
    [$tenantB] = dispatchFixture();

    $deliveryOfA = dispatchDelivery($tenantA, $orderA);
    $dispatcherOfB = dispatchStaff($tenantB, ClinicalRole::Dispatcher);

    $this->actingAs($dispatcherOfB)
        ->getJson(dispatchUrl($tenantB, "/api/v1/deliveries/{$deliveryOfA->id}"))
        ->assertNotFound();
});

it('audits dispatch and assignment with identifiers only', function () {
    [$tenant, $order] = dispatchFixture();
    $dispatcher = dispatchStaff($tenant, ClinicalRole::Dispatcher);
    $rider = dispatchStaff($tenant, ClinicalRole::Rider);

    $deliveryId = $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, '/api/v1/deliveries'), dispatchBody($order))
        ->assertCreated()
        ->json('data.id');

    $this->actingAs($dispatcher)
        ->postJson(dispatchUrl($tenant, "/api/v1/deliveries/{$deliveryId}/assign"), [
            'rider_id' => $rider->id,
        ])->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        $actions = AuditEvent::query()->pluck('action')->all();

        expect($actions)->toContain('delivery.created')
            ->and($actions)->toContain('delivery.assigned');

        // Identifiers and outcomes. The recipient's name, phone and address are
        // not the audit log's business.
        $created = AuditEvent::query()->where('action', 'delivery.created')->firstOrFail();

        expect($created->metadata)->toBe(['dispense_order_id' => $order->id]);
    });
});
