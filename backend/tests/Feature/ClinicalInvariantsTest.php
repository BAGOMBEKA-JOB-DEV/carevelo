<?php

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\ConsultationMode;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\DispenseOrder;
use App\Models\Prescription;
use App\Models\PrescriptionStatus;
use App\Models\Substitution;
use App\Models\SubstitutionStatus;
use App\Models\Tenant;
use App\Tenancy\Tenancy;

/*
|--------------------------------------------------------------------------
| Clinical invariants
|--------------------------------------------------------------------------
|
| These are the rules that carry legal weight. Each keeps Carevelo a software
| supplier rather than a healthcare provider, a drug handler, or a payment
| service provider.
|
*/

function inTenant(callable $callback): mixed
{
    return app(Tenancy::class)->run(Tenant::factory()->create()->id, $callback);
}

// --- Prescribing -----------------------------------------------------------

it('refuses to issue a prescription without prescribing rights', function () {
    // The single most important check in the system: it is what keeps the
    // platform a recorder rather than an issuer.
    inTenant(function () {
        $consultation = Consultation::factory()->create();
        $clinician = Clinician::factory()->cannotPrescribe()->create();

        Prescription::issue($consultation, $clinician, []);
    });
})->throws(IllegalTransition::class, 'cannot prescribe');

it('refuses to issue a prescription without a registration number', function () {
    inTenant(function () {
        $consultation = Consultation::factory()->create();
        $clinician = Clinician::factory()->withoutRegistrationNumber()->create();

        Prescription::issue($consultation, $clinician, []);
    });
})->throws(IllegalTransition::class, 'cannot prescribe');

it('refuses to prescribe when the clinician judged remote care unsafe', function () {
    // outcome = converted_to_in_person is a HARD constraint, not a warning.
    inTenant(function () {
        $consultation = Consultation::factory()->convertedToInPerson()->create();
        $clinician = Clinician::factory()->create();

        Prescription::issue($consultation, $clinician, []);
    });
})->throws(IllegalTransition::class, 'did not complete');

it('snapshots the clinician identity onto the prescription', function () {
    // Snapshotted, not joined: if the clinician later leaves the tenant or
    // corrects their registration number, the historical document must still
    // show what was actually on it.
    //
    // Note the assertions run INSIDE the tenant context. Outside it, RLS
    // correctly hides the rows -- reading a relation after the context has
    // unwound returns nothing, which is the isolation model working.
    inTenant(function () {
        $consultation = Consultation::factory()->create();
        $clinician = Clinician::factory()->create(['registration_number' => 'UMDPC-99999']);

        $prescription = Prescription::issue($consultation, $clinician, [[
            'medicine_name' => 'Amoxicillin',
            'quantity' => 21,
            'directions' => 'One capsule three times daily',
        ]]);

        expect($prescription->clinician_registration_snapshot)->toBe('UMDPC-99999')
            ->and($prescription->items()->count())->toBe(1);
    });
});

it('is immutable after issue', function () {
    inTenant(function () {
        $prescription = Prescription::factory()->create();
        $prescription->clinician_registration_snapshot = 'TAMPERED';
        $prescription->save();
    });
})->throws(LogicException::class, 'immutable after issue');

it('is corrected by cancelling and replacing, not by editing', function () {
    $prescription = inTenant(function () {
        $prescription = Prescription::factory()->create();
        $prescription->cancel('Wrong dosage');

        return $prescription;
    });

    expect($prescription->status)->toBe(PrescriptionStatus::Cancelled);
});

// --- Dispensing ------------------------------------------------------------

it('refuses to dispense while a substitution awaits clinician approval', function () {
    inTenant(function () {
        $order = DispenseOrder::factory()->paid()->create();

        Substitution::factory()->create([
            'dispense_order_id' => $order->id,
            'status' => SubstitutionStatus::Pending,
        ]);

        $order->dispense('pharmacist-id');
    });
})->throws(IllegalTransition::class, 'awaits clinician approval');

it('records dispensing against a named pharmacist of the tenant', function () {
    // Carevelo never dispenses. Medicines are handed over by the clinic's own
    // NDA-licensed pharmacy staff.
    $order = inTenant(function () {
        $order = DispenseOrder::factory()->paid()->create();
        $order->dispense('pharmacist-01');

        return $order;
    });

    expect($order->pharmacist_id)->toBe('pharmacist-01')
        ->and($order->dispensed_at)->not->toBeNull();
});

// --- Delivery --------------------------------------------------------------

it('refuses to deliver an order containing a controlled item', function () {
    // Controlled substances require in-person handling under NDPA Act Cap 206.
    // There is deliberately no override.
    inTenant(function () {
        $prescription = Prescription::factory()->create();
        $prescription->items()->create([
            'medicine_name' => 'Pethidine',
            'quantity' => 5,
            'directions' => 'As directed',
            'is_controlled' => true,
        ]);

        $order = DispenseOrder::factory()->create(['prescription_id' => $prescription->id]);

        Delivery::createFor($order, [
            'reference' => 'DLV-2608-0001',
            'recipient_name' => 'Aisha',
            'recipient_phone' => '+256772123456',
            'address_text' => 'Ntinda',
        ]);
    });
})->throws(IllegalTransition::class, 'controlled item');

it('rejects a delivery failure reason that is not on the fixed list', function () {
    // Free text alone cannot be reported on.
    inTenant(function () {
        $delivery = Delivery::factory()->create();
        $delivery->assignTo('rider-1');
        $delivery->transitionTo(DeliveryStatus::PickedUp);
        $delivery->transitionTo(DeliveryStatus::EnRoute);
        $delivery->fail('rider felt like it');
    });
})->throws(IllegalTransition::class, 'must be one of');

it('writes an event for every delivery transition', function () {
    // This is the status thread the patient sees.
    // The assertions run INSIDE the tenant context. Outside it, RLS correctly
    // hides the rows -- reading a relation after the context has unwound
    // returns nothing, which is the isolation model working, not a bug.
    inTenant(function () {
        $delivery = Delivery::factory()->create();
        $delivery->assignTo('rider-1');
        $delivery->transitionTo(DeliveryStatus::PickedUp);
        $delivery->transitionTo(DeliveryStatus::EnRoute);
        $delivery->transitionTo(DeliveryStatus::Delivered);

        expect($delivery->events()->count())->toBe(4)
            ->and($delivery->delivered_at)->not->toBeNull();
    });
});

// --- Consultation ----------------------------------------------------------

it('records a mode step-down truthfully', function () {
    // A video call that fell back to voice is recorded as voice. The truthful
    // record is the only honest measure of what patients actually experience.
    $consultation = inTenant(function () {
        $consultation = Consultation::factory()->create();
        $consultation->degradeTo(ConsultationMode::Voice);

        return $consultation;
    });

    expect($consultation->mode_used)->toBe(ConsultationMode::Voice);
});
