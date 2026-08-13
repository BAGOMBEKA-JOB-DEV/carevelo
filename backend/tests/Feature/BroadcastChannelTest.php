<?php

use App\Broadcasting\ConsultationChannel;
use App\Broadcasting\DispatchBoardChannel;
use App\Broadcasting\PatientChannel;
use App\Broadcasting\PharmacyQueueChannel;
use App\Broadcasting\RiderChannel;
use App\Broadcasting\TenantChannel;
use App\Broadcasting\TenantPrefixedChannel;
use App\Broadcasting\UserChannel;
use App\Events\DeliveryAssigned;
use App\Events\DeliveryDelivered;
use App\Events\DeliveryFailed;
use App\Events\OrderDispensed;
use App\Events\PaymentIntentFailed;
use App\Events\PaymentIntentSucceeded;
use App\Events\PrescriptionIssued;
use App\Events\SubstitutionApproved;
use App\Events\SubstitutionProposed;
use App\Events\TenantBroadcast;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Consultation;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\DispenseOrder;
use App\Models\Patient;
use App\Models\PaymentIntent;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\Substitution;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Realtime broadcasting — the four rules
|--------------------------------------------------------------------------
|
| 1. Every channel is private and tenant-prefixed.
| 2. Authorisation runs the same policies as the REST API, plus a tenant-prefix
|    check against the session tenant. A mismatch is refused and audited.
| 3. Payloads carry identifiers and state only — never clinical content.
| 4. A broadcast is a hint to refresh, never authoritative.
|
| A channel is the one surface where a tenancy mistake is PUSHED to the wrong
| person rather than waiting to be requested, so each rule is tested rather
| than asserted in a comment.
|
| Channel classes are exercised directly instead of through /broadcasting/auth:
| join() is the whole decision, and calling it leaves nowhere for a fixture to
| accidentally satisfy a check that production would not.
|
| @see docs/30-architecture/realtime-broadcasting.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function broadcastStaff(Tenant $tenant, ClinicalRole $role, bool $active = true): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role, $active) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'is_active' => $active]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * A clinic with one of everything, seeded with content that must never reach a
 * frame: a medicine name, a clinical direction, a patient's name, their phone
 * and their address.
 *
 * @return array{tenant: Tenant, events: array<string, TenantBroadcast>, forbidden: list<string>}
 */
function broadcastFixture(): array
{
    $tenant = Tenant::factory()->create();

    $events = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $patient = Patient::factory()->create([
            'given_name' => 'Aisha',
            'family_name' => 'Nakato',
            'phone' => '+256772123456',
            'address' => 'Plot 14, Bugolobi',
        ]);

        $prescription = Prescription::factory()->create(['patient_id' => $patient->id]);
        $item = PrescriptionItem::factory()->create(['prescription_id' => $prescription->id]);

        $order = DispenseOrder::factory()->create([
            'prescription_id' => $prescription->id,
            'patient_id' => $patient->id,
        ]);

        $substitution = Substitution::factory()->create([
            'dispense_order_id' => $order->id,
            'prescription_item_id' => $item->id,
            'proposed_medicine_name' => 'Amoxicillin 250mg',
            'reason' => 'Prescribed strength out of stock',
        ]);

        $rider = User::factory()->create(['tenant_id' => $tenant->id]);
        $clinician = User::factory()->create(['tenant_id' => $tenant->id]);

        $delivery = Delivery::factory()->create([
            'dispense_order_id' => $order->id,
            'rider_id' => $rider->id,
            'recipient_name' => 'Aisha Nakato',
            'recipient_phone' => '+256772123456',
            'address_text' => 'Plot 14, Bugolobi',
            'landmark' => 'Opposite the Shell station',
            'status' => DeliveryStatus::Assigned,
        ]);

        $failed = Delivery::factory()->create([
            'dispense_order_id' => $order->id,
            'status' => DeliveryStatus::Failed,
            'failure_reason' => 'recipient_unreachable',
        ]);

        $intent = PaymentIntent::factory()->create();

        return [
            'prescription.issued' => PrescriptionIssued::from($prescription, $order),
            'order.dispensed' => OrderDispensed::from($order),
            'substitution.proposed' => SubstitutionProposed::from($substitution, $order, $clinician->id),
            'substitution.decided' => SubstitutionApproved::from($substitution, $order),
            'delivery.assigned' => DeliveryAssigned::from($delivery),
            'delivery.delivered' => DeliveryDelivered::from($delivery, $order),
            'delivery.failed' => DeliveryFailed::from($failed, $order),
            'payment_intent.succeeded' => PaymentIntentSucceeded::from($intent, $patient->id, $clinician->id),
            'payment_intent.failed' => PaymentIntentFailed::from($intent, $patient->id, $clinician->id),
        ];
    });

    return [
        'tenant' => $tenant,
        'events' => $events,
        'forbidden' => [
            'amoxicillin',      // the medicine
            'capsule',          // its form
            'three times',      // the directions
            'aisha',            // the patient
            'nakato',
            '772123456',        // her phone
            'bugolobi',         // her address
            'shell station',    // her landmark
            'out of stock',     // the pharmacist's free text
        ],
    ];
}

/*
|--------------------------------------------------------------------------
| Rule 1 — every channel is private and tenant-prefixed
|--------------------------------------------------------------------------
*/

it('prefixes every channel name with the tenant and makes it private', function () {
    $tenantId = '01J8XKTENANTAAAAAAAAAAAAAA';

    $channels = [
        TenantChannel::pharmacyQueue($tenantId),
        TenantChannel::dispatchBoard($tenantId),
        TenantChannel::user($tenantId, 'user-1'),
        TenantChannel::patient($tenantId, 'patient-1'),
        TenantChannel::rider($tenantId, 'rider-1'),
        TenantChannel::consultation($tenantId, 'consultation-1'),
    ];

    foreach ($channels as $channel) {
        expect((string) $channel)->toStartWith("private-tenant.{$tenantId}.");
    }

    expect((string) $channels[0])->toBe("private-tenant.{$tenantId}.pharmacy-queue")
        ->and((string) $channels[4])->toBe("private-tenant.{$tenantId}.rider.rider-1");
});

it('cannot construct an unprefixed channel name', function () {
    // The helper is the only way to name a channel, so this is the property
    // that makes "always tenant-prefixed" structural rather than remembered.
    expect(fn () => TenantChannel::pharmacyQueue(''))
        ->toThrow(InvalidArgumentException::class);

    expect(fn () => TenantChannel::patient('', 'patient-1'))
        ->toThrow(InvalidArgumentException::class);

    // A dot would smuggle an extra segment in and produce a name that
    // authorises as one channel and delivers as another.
    expect(fn () => TenantChannel::rider('tenant-a.rider', 'rider-1'))
        ->toThrow(InvalidArgumentException::class);

    expect(fn () => TenantChannel::user('tenant-a', 'user.1'))
        ->toThrow(InvalidArgumentException::class);
});

it('registers only tenant-prefixed channels, each handled by a guarded class', function () {
    $registered = Broadcast::getChannels();

    expect($registered->keys()->all())->toEqualCanonicalizing(TenantChannel::patterns());

    foreach ($registered as $pattern => $handler) {
        expect($pattern)->toStartWith('tenant.{tenantId}.')
            ->and($handler)->toBeString();

        /** @var TenantPrefixedChannel $channel */
        $channel = app($handler);

        // Class-based, so no registration can implement the tenant check and
        // forget the policy check, or the other way round.
        expect($channel)->toBeInstanceOf(TenantPrefixedChannel::class)
            ->and($channel->pattern())->toBe($pattern);
    }
});

/*
|--------------------------------------------------------------------------
| Rule 2 — the same policies as the REST API, plus the tenant prefix
|--------------------------------------------------------------------------
*/

it('lets a pharmacist join their own clinic pharmacy queue', function () {
    $tenant = Tenant::factory()->create();
    $pharmacist = broadcastStaff($tenant, ClinicalRole::Pharmacist);

    expect(app(PharmacyQueueChannel::class)->join($pharmacist, $tenant->id))->toBeTrue();
});

it('refuses another clinic pharmacy queue and audits the mismatch', function () {
    // The defining failure: a pharmacist of clinic A asking for clinic B's
    // queue. Refused on the prefix, before any policy runs, and recorded --
    // it means either a bug or an attack, and both deserve a record.
    $clinicA = Tenant::factory()->create();
    $clinicB = Tenant::factory()->create();
    $pharmacist = broadcastStaff($clinicA, ClinicalRole::Pharmacist);

    expect(app(PharmacyQueueChannel::class)->join($pharmacist, $clinicB->id))->toBeFalse();

    app(Tenancy::class)->run($clinicA->id, function () use ($clinicA, $clinicB, $pharmacist) {
        $event = AuditEvent::query()->where('action', 'broadcast.tenant_mismatch')->firstOrFail();

        // Attributed to the pharmacist's OWN clinic. The requested tenant is
        // client input; writing into the clinic an attacker named would let
        // them post entries in someone else's trail.
        expect($event->tenant_id)->toBe($clinicA->id)
            ->and($event->actor_id)->toBe($pharmacist->id)
            // Identifiers and outcomes. Key order is whatever jsonb chose.
            ->and($event->metadata)->toEqualCanonicalizing([
                'channel' => TenantChannel::PHARMACY_QUEUE,
                'requested_tenant_id' => $clinicB->id,
                'session_tenant_id' => $clinicA->id,
            ]);
    });

    // And nothing was written into the clinic that was asked for.
    app(Tenancy::class)->run(
        $clinicB->id,
        fn () => expect(AuditEvent::query()->count())->toBe(0)
    );
});

it('refuses a user of the right clinic with the wrong role', function () {
    // The second half of rule 2. The tenant matches; DeliveryPolicy::viewAny
    // does not -- the dispatch board is every recipient and every address in
    // the clinic at once, and a rider never sees it.
    $tenant = Tenant::factory()->create();
    $rider = broadcastStaff($tenant, ClinicalRole::Rider);
    $dispatcher = broadcastStaff($tenant, ClinicalRole::Dispatcher);

    expect(app(DispatchBoardChannel::class)->join($rider, $tenant->id))->toBeFalse()
        ->and(app(DispatchBoardChannel::class)->join($dispatcher, $tenant->id))->toBeTrue();

    // A wrong-role refusal is not a tenant mismatch and is not audited as one.
    app(Tenancy::class)->run($tenant->id, fn () => expect(
        AuditEvent::query()->where('action', 'broadcast.tenant_mismatch')->count()
    )->toBe(0));
});

it('refuses a deactivated account', function () {
    // Subscription is authorised once, at subscribe time, and every reconnect
    // re-authorises. Deactivation has to fail here, not only at the next
    // HTTP request.
    $tenant = Tenant::factory()->create();
    $pharmacist = broadcastStaff($tenant, ClinicalRole::Pharmacist, active: false);

    expect(app(PharmacyQueueChannel::class)->join($pharmacist, $tenant->id))->toBeFalse();
});

it('refuses a platform user every tenant channel', function () {
    // Platform roles reach no clinical data without an audited break-glass
    // grant, and there is no platform-wide channel to reach it on either.
    $tenant = Tenant::factory()->create();
    $platform = User::factory()->create(['tenant_id' => null]);
    $platform->assignRole(ClinicalRole::PlatformAdmin->value);

    expect(app(PharmacyQueueChannel::class)->join($platform, $tenant->id))->toBeFalse();

    // Recorded as a platform row: the actor has no tenant to attribute it to.
    expect(AuditEvent::query()->where('action', 'broadcast.tenant_mismatch')->count())->toBe(1);
});

it('keeps a personal channel personal', function () {
    $tenant = Tenant::factory()->create();
    $clinician = broadcastStaff($tenant, ClinicalRole::Clinician);
    $administrator = broadcastStaff($tenant, ClinicalRole::ClinicAdmin);

    expect(app(UserChannel::class)->join($clinician, $tenant->id, $clinician->id))->toBeTrue()
        // Seniority is not subscription. An administrator does not listen in
        // on a clinician's substitution approvals.
        ->and(app(UserChannel::class)->join($administrator, $tenant->id, $clinician->id))->toBeFalse()
        ->and(app(UserChannel::class)->join($clinician, $tenant->id))->toBeFalse();
});

it('lets a rider subscribe only to their own rider channel', function () {
    $tenant = Tenant::factory()->create();
    $elsewhere = Tenant::factory()->create();

    $rider = broadcastStaff($tenant, ClinicalRole::Rider);
    $otherRider = broadcastStaff($tenant, ClinicalRole::Rider);
    $dispatcher = broadcastStaff($tenant, ClinicalRole::Dispatcher);
    $riderElsewhere = broadcastStaff($elsewhere, ClinicalRole::Rider);

    $channel = app(RiderChannel::class);

    expect($channel->join($rider, $tenant->id, $rider->id))->toBeTrue()
        // Not another rider's assignments.
        ->and($channel->join($rider, $tenant->id, $otherRider->id))->toBeFalse()
        // Not a rider channel belonging to someone at another clinic, even
        // with that clinic's prefix.
        ->and($channel->join($rider, $elsewhere->id, $riderElsewhere->id))->toBeFalse()
        // Not their own id under another clinic's prefix.
        ->and($channel->join($rider, $elsewhere->id, $rider->id))->toBeFalse()
        // And a non-rider does not join a rider channel either.
        ->and($channel->join($dispatcher, $tenant->id, $dispatcher->id))->toBeFalse();

    // The rider is also on none of the role channels.
    expect(app(DispatchBoardChannel::class)->join($rider, $tenant->id))->toBeFalse()
        ->and(app(PharmacyQueueChannel::class)->join($rider, $tenant->id))->toBeFalse();
});

it('authorises a patient channel through the same policy as the patient endpoint', function () {
    $tenant = Tenant::factory()->create();
    $clinician = broadcastStaff($tenant, ClinicalRole::Clinician);
    $rider = broadcastStaff($tenant, ClinicalRole::Rider);

    $patient = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());

    expect(app(PatientChannel::class)->join($clinician, $tenant->id, $patient->id))->toBeTrue()
        // PatientPolicy has no rider method, deliberately: a rider reaches no
        // patient record at all.
        ->and(app(PatientChannel::class)->join($rider, $tenant->id, $patient->id))->toBeFalse();
});

it('cannot reach a patient of another clinic through its own prefix', function () {
    // The subject lookup runs with row-level security bound to the SESSION
    // tenant, so another clinic's patient simply is not there -- the same
    // shape as the API's 404-not-403.
    $clinicA = Tenant::factory()->create();
    $clinicB = Tenant::factory()->create();

    $clinicianOfA = broadcastStaff($clinicA, ClinicalRole::Clinician);
    $patientOfB = app(Tenancy::class)->run($clinicB->id, fn () => Patient::factory()->create());

    expect(app(PatientChannel::class)->join($clinicianOfA, $clinicA->id, $patientOfB->id))->toBeFalse();
});

it('authorises a consultation channel through the consultation policy', function () {
    $tenant = Tenant::factory()->create();
    $clinician = broadcastStaff($tenant, ClinicalRole::Clinician);
    $pharmacist = broadcastStaff($tenant, ClinicalRole::Pharmacist);

    $consultation = app(Tenancy::class)->run($tenant->id, fn () => Consultation::factory()->create());

    expect(app(ConsultationChannel::class)->join($clinician, $tenant->id, $consultation->id))->toBeTrue()
        ->and(app(ConsultationChannel::class)->join($pharmacist, $tenant->id, $consultation->id))->toBeFalse();
});

/*
|--------------------------------------------------------------------------
| Rule 3 — identifiers and state only
|--------------------------------------------------------------------------
*/

it('puts no clinical content, patient name or contact detail in any payload', function () {
    // A frame is a disclosure surface exactly as an SMS is, and sharper in one
    // respect: a role channel fans out to every subscriber at once.
    ['events' => $events, 'forbidden' => $forbidden] = broadcastFixture();

    expect($events)->toHaveCount(9);

    foreach ($events as $name => $event) {
        $payload = strtolower((string) json_encode($event->broadcastWith()));

        foreach ($forbidden as $term) {
            expect($payload)->not->toContain($term, "{$name} leaked '{$term}'");
        }
    }
});

it('names only identifiers and state in payload keys', function () {
    // An allow-list rather than a deny-list: a new field has to be argued for
    // here before it can reach a socket.
    $permitted = [
        'prescription_id', 'dispense_order_id', 'order_id', 'delivery_id',
        'substitution_id', 'payment_intent_id',
        'reference', 'order_reference', 'status', 'failure_reason',
    ];

    ['events' => $events] = broadcastFixture();

    foreach ($events as $name => $event) {
        // Asserted against the encoded frame rather than the array, because
        // the frame is what leaves the building.
        $payload = json_decode((string) json_encode($event->broadcastWith()), true);

        expect($payload)->toBeArray();

        foreach ((array) $payload as $key => $value) {
            expect(in_array($key, $permitted, true))
                ->toBeTrue("{$name} broadcasts an unexpected field '{$key}'");

            // Flat scalars only. A nested object is a model in disguise.
            expect($value === null || is_string($value))
                ->toBeTrue("{$name}.{$key} is not a scalar identifier");
        }
    }
});

it('addresses every event to private tenant-prefixed channels', function () {
    ['tenant' => $tenant, 'events' => $events] = broadcastFixture();

    foreach ($events as $name => $event) {
        expect($event->broadcastOn())->not->toBeEmpty("{$name} broadcasts nowhere");

        foreach ($event->broadcastOn() as $channel) {
            expect((string) $channel)->toStartWith("private-tenant.{$tenant->id}.");
        }
    }
});

it('drops a free-text failure reason rather than forwarding it', function () {
    // The reason column is a fixed list at the API boundary, but free text is
    // where clinical content escapes, so the frame re-checks rather than
    // trusting what it was handed.
    $tenant = Tenant::factory()->create();

    $event = app(Tenancy::class)->run($tenant->id, function () {
        $order = DispenseOrder::factory()->create();

        $delivery = Delivery::factory()->create([
            'dispense_order_id' => $order->id,
            'status' => DeliveryStatus::Failed,
            'failure_reason' => 'nobody home, Amoxicillin returned to the pharmacy',
        ]);

        return DeliveryFailed::from($delivery, $order);
    });

    expect($event->broadcastWith()['failure_reason'])->toBeNull();
});

/*
|--------------------------------------------------------------------------
| Rule 4 — a hint to refresh, never authoritative
|--------------------------------------------------------------------------
*/

it('carries no model into a broadcast', function () {
    // SerializesModels would re-fetch the record in a queue worker, where
    // there is no tenant context -- and would put an attribute bag one
    // careless change away from the wire. Events hold strings instead, which
    // is what makes "identifiers and state only" structural.
    $files = glob(app_path('Events/*.php'));

    expect($files)->not->toBeFalse();

    $classes = array_map(
        fn (string $file) => 'App\\Events\\'.basename($file, '.php'),
        $files ?: []
    );

    // The base class plus the nine documented domain events.
    expect($classes)->toHaveCount(10);

    foreach ($classes as $class) {
        expect(is_a($class, TenantBroadcast::class, true))
            ->toBeTrue("{$class} does not extend TenantBroadcast");

        expect(class_uses_recursive($class))
            ->not->toContain(SerializesModels::class, "{$class} serialises a model into a frame");
    }
});
