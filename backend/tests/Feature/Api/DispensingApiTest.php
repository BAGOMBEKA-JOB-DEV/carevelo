<?php

use App\Events\OrderDispensed;
use App\Events\SubstitutionApproved;
use App\Events\SubstitutionProposed;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\DispenseItem;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\Substitution;
use App\Models\SubstitutionStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Event;

/*
|--------------------------------------------------------------------------
| H4 §2–4 — the pharmacy bench
|--------------------------------------------------------------------------
|
| The exception paths are the product. A substitute dispensed without a
| clinician's approval, an item silently dropped from an order, or a medicine
| name reaching a queue listing are each a regulatory failure rather than a
| bug, so each has a test of its own below.
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

function rxUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function rxStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * An order in the pharmacy queue, two items on the prescription.
 *
 * Two items rather than one on purpose: a single-item order cannot show that a
 * pending substitution blocks ONLY its own line, which is the behaviour the
 * pharmacy actually depends on.
 *
 * @return array{Tenant, DispenseOrder, PrescriptionItem, PrescriptionItem, User}
 */
function rxFixture(): array
{
    $tenant = Tenant::factory()->create();
    $clinicianUser = rxStaff($tenant, ClinicalRole::Clinician);

    [$order, $itemA, $itemB] = app(Tenancy::class)->run($tenant->id, function () use ($clinicianUser) {
        $clinician = Clinician::factory()->create(['user_id' => $clinicianUser->id]);
        $patient = Patient::factory()->create();

        $prescription = Prescription::factory()->create([
            'patient_id' => $patient->id,
            'clinician_id' => $clinician->id,
        ]);

        $itemA = PrescriptionItem::factory()->create([
            'prescription_id' => $prescription->id,
            'medicine_name' => 'Amoxicillin 500mg',
        ]);

        $itemB = PrescriptionItem::factory()->create([
            'prescription_id' => $prescription->id,
            'medicine_name' => 'Paracetamol 500mg',
        ]);

        $order = DispenseOrder::factory()->create([
            'prescription_id' => $prescription->id,
            'patient_id' => $patient->id,
            'status' => DispenseOrderStatus::Received,
        ]);

        return [$order, $itemA, $itemB];
    });

    return [$tenant, $order, $itemA, $itemB, $clinicianUser];
}

/** Move an order straight to a state, bypassing the endpoints under test. */
function rxSetStatus(Tenant $tenant, DispenseOrder $order, DispenseOrderStatus $status): void
{
    app(Tenancy::class)->run($tenant->id, function () use ($order, $status) {
        $order->status = $status;
        $order->save();
    });
}

/**
 * A priced line.
 *
 * @return array<string, mixed>
 */
function rxLine(PrescriptionItem $item, string $name, int $unitPriceMinor = 50_000, int $quantity = 21): array
{
    return [
        'prescription_item_id' => $item->id,
        'medicine_name_dispensed' => $name,
        'quantity_dispensed' => $quantity,
        'unit_price_minor' => $unitPriceMinor,
    ];
}

it('shows the pharmacy queue to a pharmacist, without naming any medicine', function () {
    // The queue is the most-displayed screen in the pharmacy and is read over
    // shoulders. It carries references and states; the contents live behind the
    // detail endpoint, where the policy runs.
    [$tenant] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $response = $this->actingAs($pharmacist)
        ->getJson(rxUrl($tenant, '/api/v1/dispense-orders'))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.status', DispenseOrderStatus::Received->value);

    $body = strtolower(json_encode($response->json()) ?: '');

    foreach (['amoxicillin', 'paracetamol', 'directions', 'diagnosis'] as $term) {
        expect($body)->not->toContain($term, "Pharmacy queue leaked '{$term}'");
    }
});

it('keeps the pharmacy queue away from a rider', function () {
    // The queue is every prescription in the clinic at once. The rider is the
    // least-trusted actor in the system.
    [$tenant] = rxFixture();
    $rider = rxStaff($tenant, ClinicalRole::Rider);

    $this->actingAs($rider)
        ->getJson(rxUrl($tenant, '/api/v1/dispense-orders'))
        ->assertForbidden();
});

it('opens an order onto the bench', function () {
    [$tenant, $order] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/open"))
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::UnderReview->value);
});

it('refuses to open the same order twice', function () {
    [$tenant, $order] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/open"))
        ->assertOk();

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/open"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('prices an order at the clinic own prices and totals it', function () {
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 500mg', unitPriceMinor: 50_000, quantity: 21),
                rxLine($itemB, 'Paracetamol 500mg', unitPriceMinor: 10_000, quantity: 10),
            ],
            'delivery_fee_minor' => 500_000,
        ])
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::Priced->value)
        // 21 * 50_000 + 10 * 10_000 = 1_150_000
        ->assertJsonPath('data.subtotal.amount_minor', 1_150_000)
        ->assertJsonPath('data.delivery_fee.amount_minor', 500_000)
        ->assertJsonPath('data.total.amount_minor', 1_650_000);

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect(DispenseItem::query()->where('dispense_order_id', $order->id)->count())->toBe(2);
    });
});

it('refuses to price an item that is not on the prescription', function () {
    [$tenant, $order, $itemA] = rxFixture();
    // An item belonging to an entirely different clinic's prescription.
    [, , $foreignItem] = rxFixture();

    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 500mg'),
                rxLine($foreignItem, 'Something else entirely'),
            ],
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect(DispenseItem::query()->where('dispense_order_id', $order->id)->count())->toBe(0)
            ->and($order->refresh()->status)->toBe(DispenseOrderStatus::UnderReview);
    });
});

it('refuses to price an order with an item silently left out', function () {
    // A dropped line is a medicine the patient is never told they did not get.
    // Every prescribed item is filled or explicitly unfulfilled with a reason.
    [$tenant, $order, $itemA] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [rxLine($itemA, 'Amoxicillin 500mg')],
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('requires a reason on an unfulfilled line', function () {
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 500mg'),
                [...rxLine($itemB, 'Paracetamol 500mg'), 'is_fulfilled' => false],
            ],
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('rejects an unrecognised field rather than discarding it', function () {
    // A mistyped price is an order the patient is charged the wrong amount for.
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                [...rxLine($itemA, 'Amoxicillin 500mg'), 'unit_prices_minor' => 1],
                rxLine($itemB, 'Paracetamol 500mg'),
            ],
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');
});

it('refuses a partial fill that did not come from a substitution', function () {
    // partially_priced is reachable only from awaiting_substitution. An order
    // that never had a substitution cannot arrive at a partial fill, and the
    // state machine says so rather than silently downgrading the order.
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 500mg'),
                [
                    ...rxLine($itemB, 'Paracetamol 500mg', quantity: 0),
                    'is_fulfilled' => false,
                    'unfulfilled_reason' => 'Out of stock, no alternative held',
                ],
            ],
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('records the pharmacy declining to fill, with a reason', function () {
    [$tenant, $order] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/reject"), [
            'reason' => 'Prescription illegible, clinician contacted',
        ])
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::Rejected->value)
        ->assertJsonPath('data.rejection_reason', 'Prescription illegible, clinician contacted');
});

it('dispenses against a named pharmacist and announces it without contents', function () {
    Event::fake([OrderDispensed::class]);

    [$tenant, $order] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::Paid);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/dispense"))
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::Dispensed->value)
        ->assertJsonPath('data.pharmacist_id', $pharmacist->id);

    app(Tenancy::class)->run($tenant->id, function () use ($order, $pharmacist) {
        $order->refresh();

        expect($order->pharmacist_id)->toBe($pharmacist->id)
            ->and($order->dispensed_at)->not->toBeNull();
    });

    Event::assertDispatched(OrderDispensed::class, function (OrderDispensed $event) use ($order) {
        // Identifiers and state. A frame is a disclosure surface exactly as an
        // SMS is, and the pharmacy leg fans out to every pharmacist at once.
        $payload = strtolower(json_encode($event->broadcastWith()) ?: '');

        expect($payload)->not->toContain('amoxicillin')
            ->and($payload)->not->toContain('paracetamol');

        return $event->orderId === $order->id;
    });
});

it('refuses to let an administrator dispense', function () {
    // Only the clinic's own licensed pharmacy staff hand medicine over
    // (NDPA Act Cap 206). An administrator may run the bench but may not
    // dispense, and Carevelo never dispenses at all.
    [$tenant, $order] = rxFixture();
    $admin = rxStaff($tenant, ClinicalRole::ClinicAdmin);
    rxSetStatus($tenant, $order, DispenseOrderStatus::Paid);

    $this->actingAs($admin)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/dispense"))
        ->assertForbidden();
});

it('refuses to dispense while a substitution is still pending', function () {
    [$tenant, $order, $itemA] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
        'status' => SubstitutionStatus::Pending,
    ]));

    rxSetStatus($tenant, $order, DispenseOrderStatus::Paid);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/dispense"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect($order->refresh()->status)->toBe(DispenseOrderStatus::Paid)
            ->and($order->pharmacist_id)->toBeNull();
    });
});

it('lets a pharmacist propose a substitute and notifies the prescribing clinician only', function () {
    Event::fake([SubstitutionProposed::class]);

    [$tenant, $order, $itemA, , $clinicianUser] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/substitutions"), [
            'prescription_item_id' => $itemA->id,
            'proposed_medicine_name' => 'Amoxicillin 250mg',
            'reason' => 'Prescribed strength out of stock',
        ])
        ->assertCreated()
        ->assertJsonPath('data.status', SubstitutionStatus::Pending->value)
        ->assertJsonPath('data.proposed_by', $pharmacist->id);

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect($order->refresh()->status)->toBe(DispenseOrderStatus::AwaitingSubstitution);
    });

    Event::assertDispatched(SubstitutionProposed::class, function (SubstitutionProposed $event) use ($clinicianUser) {
        // Addressed to the prescribing clinician's own channel, and the
        // proposed medicine name is NOT on the wire -- it is the single most
        // tempting field to add, because the decision needs it. They fetch it
        // from the API, where the policy runs.
        $payload = strtolower(json_encode($event->broadcastWith()) ?: '');

        expect($payload)->not->toContain('amoxicillin');

        return $event->clinicianUserId === $clinicianUser->id;
    });
});

it('refuses to let the proposing pharmacist approve their own substitution', function () {
    // A substitution is a clinical decision. Not the pharmacist who proposed
    // it, not the administrator, and there is no auto-approval.
    [$tenant, $order, $itemA] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $substitution = app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
        'proposed_by' => $pharmacist->id,
    ]));

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/substitutions/{$substitution->id}/approve"))
        ->assertForbidden();

    app(Tenancy::class)->run($tenant->id, function () use ($substitution) {
        expect($substitution->refresh()->status)->toBe(SubstitutionStatus::Pending);
    });
});

it('refuses to let an administrator approve a substitution', function () {
    [$tenant, $order, $itemA] = rxFixture();
    $admin = rxStaff($tenant, ClinicalRole::ClinicAdmin);

    $substitution = app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
    ]));

    $this->actingAs($admin)
        ->postJson(rxUrl($tenant, "/api/v1/substitutions/{$substitution->id}/approve"))
        ->assertForbidden();
});

it('lets a clinician approve a substitution, recorded against them by name', function () {
    Event::fake([SubstitutionApproved::class]);

    [$tenant, $order, $itemA, , $clinicianUser] = rxFixture();

    $substitution = app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
    ]));

    $this->actingAs($clinicianUser)
        ->postJson(rxUrl($tenant, "/api/v1/substitutions/{$substitution->id}/approve"))
        ->assertOk()
        ->assertJsonPath('data.status', SubstitutionStatus::Approved->value)
        ->assertJsonPath('data.decided_by', $clinicianUser->id);

    Event::assertDispatched(SubstitutionApproved::class);
});

it('refuses to re-decide a substitution that has already been decided', function () {
    // Approved and rejected are both terminal. An approval cannot later be
    // quietly reversed into a rejection.
    [$tenant, $order, $itemA, , $clinicianUser] = rxFixture();

    $substitution = app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
    ]));

    $this->actingAs($clinicianUser)
        ->postJson(rxUrl($tenant, "/api/v1/substitutions/{$substitution->id}/approve"))
        ->assertOk();

    $this->actingAs($clinicianUser)
        ->postJson(rxUrl($tenant, "/api/v1/substitutions/{$substitution->id}/reject"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('blocks only the item a pending substitution affects', function () {
    // A single out-of-stock line must not stall the whole order, or pharmacists
    // work around the system rather than with it. H4 acceptance criterion 4.
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
        'status' => SubstitutionStatus::Pending,
    ]));

    rxSetStatus($tenant, $order, DispenseOrderStatus::AwaitingSubstitution);

    // Filling the blocked line is refused...
    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 500mg'),
                rxLine($itemB, 'Paracetamol 500mg'),
            ],
        ])
        ->assertStatus(409);

    // ...while the rest of the order prices normally, the blocked line held
    // back as unfulfilled pending the clinician's decision.
    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                [
                    ...rxLine($itemA, 'Amoxicillin 500mg', quantity: 0),
                    'is_fulfilled' => false,
                    'unfulfilled_reason' => 'Awaiting clinician decision on substitute',
                ],
                rxLine($itemB, 'Paracetamol 500mg', unitPriceMinor: 10_000, quantity: 10),
            ],
        ])
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::PartiallyPriced->value)
        // Only the filled line is charged for.
        ->assertJsonPath('data.subtotal.amount_minor', 100_000);
});

it('refuses to dispense a substitute the clinician has not approved', function () {
    // This is the control that makes clinician approval real rather than
    // advisory: without it a pharmacist could record any substitute they liked.
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $substitution = app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
        'status' => SubstitutionStatus::Pending,
    ]));

    rxSetStatus($tenant, $order, DispenseOrderStatus::AwaitingSubstitution);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                [...rxLine($itemA, 'Amoxicillin 250mg'), 'substitution_id' => $substitution->id],
                rxLine($itemB, 'Paracetamol 500mg'),
            ],
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('fills an approved substitute and traces it back to the approval', function () {
    [$tenant, $order, $itemA, $itemB, $clinicianUser] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $substitution = app(Tenancy::class)->run($tenant->id, fn () => Substitution::factory()->create([
        'dispense_order_id' => $order->id,
        'prescription_item_id' => $itemA->id,
        'status' => SubstitutionStatus::Pending,
    ]));

    rxSetStatus($tenant, $order, DispenseOrderStatus::AwaitingSubstitution);

    $this->actingAs($clinicianUser)
        ->postJson(rxUrl($tenant, "/api/v1/substitutions/{$substitution->id}/approve"))
        ->assertOk();

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                [...rxLine($itemA, 'Amoxicillin 250mg'), 'substitution_id' => $substitution->id],
                rxLine($itemB, 'Paracetamol 500mg'),
            ],
        ])
        ->assertOk()
        ->assertJsonPath('data.status', DispenseOrderStatus::Priced->value);

    app(Tenancy::class)->run($tenant->id, function () use ($order, $substitution) {
        $line = DispenseItem::query()
            ->where('dispense_order_id', $order->id)
            ->where('substitution_id', $substitution->id)
            ->firstOrFail();

        // What was DISPENSED differs from what was PRESCRIBED, and both facts
        // survive: the prescription still says 500mg.
        expect($line->medicine_name_dispensed)->toBe('Amoxicillin 250mg');
    });
});

it('never mutates the prescription while dispensing', function () {
    // H4 acceptance criterion 2. The prescription is a clinical document.
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);
    rxSetStatus($tenant, $order, DispenseOrderStatus::UnderReview);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 250mg'),
                rxLine($itemB, 'Ibuprofen 400mg'),
            ],
        ])
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($itemA, $itemB) {
        expect($itemA->refresh()->medicine_name)->toBe('Amoxicillin 500mg')
            ->and($itemB->refresh()->medicine_name)->toBe('Paracetamol 500mg');
    });
});

it('returns 404 not 403 for an order in another clinic', function () {
    // A 403 would confirm the order exists, and therefore that a given person
    // is a patient of some other clinic.
    [$tenantA, $orderA] = rxFixture();
    [$tenantB] = rxFixture();

    $pharmacistOfB = rxStaff($tenantB, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacistOfB)
        ->getJson(rxUrl($tenantB, "/api/v1/dispense-orders/{$orderA->id}"))
        ->assertNotFound();
});

it('audits the bench with identifiers and outcomes, never medicine names', function () {
    [$tenant, $order, $itemA, $itemB] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/open"))
        ->assertOk();

    $this->actingAs($pharmacist)
        ->postJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}/price"), [
            'items' => [
                rxLine($itemA, 'Amoxicillin 500mg', unitPriceMinor: 50_000, quantity: 21),
                rxLine($itemB, 'Paracetamol 500mg', unitPriceMinor: 10_000, quantity: 10),
            ],
        ])
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        $actions = AuditEvent::query()->pluck('action')->all();

        expect($actions)->toContain('dispense_order.opened')
            ->and($actions)->toContain('dispense_order.priced');

        $priced = AuditEvent::query()->where('action', 'dispense_order.priced')->firstOrFail();

        // An amount is an outcome and belongs here. A medicine name is content
        // and never does.
        //
        // Key order is not asserted: metadata is stored as jsonb, which orders
        // keys by its own rules on the way in.
        expect($priced->metadata)->toHaveCount(4)
            ->and($priced->metadata)->toHaveKey('item_count', 2)
            ->and($priced->metadata)->toHaveKey('unfulfilled_count', 0)
            ->and($priced->metadata)->toHaveKey('total_minor', 1_150_000)
            ->and($priced->metadata)->toHaveKey('currency', 'UGX')
            ->and($priced->subject_id)->toBe($order->id);

        $body = strtolower(json_encode(AuditEvent::query()->get()->toArray()) ?: '');

        foreach (['amoxicillin', 'paracetamol'] as $term) {
            expect($body)->not->toContain($term, "Audit trail leaked '{$term}'");
        }
    });
});

it('audits a read of the order detail', function () {
    // "Who looked at my records?" can only be answered by having recorded
    // every look, so reads of clinical records are audited as well as writes.
    [$tenant, $order] = rxFixture();
    $pharmacist = rxStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->getJson(rxUrl($tenant, "/api/v1/dispense-orders/{$order->id}"))
        ->assertOk()
        ->assertJsonPath('data.prescription.items.0.medicine_name', 'Amoxicillin 500mg');

    app(Tenancy::class)->run($tenant->id, function () use ($order) {
        expect(AuditEvent::query()->where('action', 'dispense_order.read')->where('subject_id', $order->id)->exists())
            ->toBeTrue();
    });
});
