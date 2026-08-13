<?php

use App\Http\Controllers\Api\V1\AppointmentController;
use App\Http\Controllers\Api\V1\ClinicalNoteController;
use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Controllers\Api\V1\ConsultationController;
use App\Http\Controllers\Api\V1\DeliveryController;
use App\Http\Controllers\Api\V1\DispenseOrderController;
use App\Http\Controllers\Api\V1\PatientController;
use App\Http\Controllers\Api\V1\PaymentIntentController;
use App\Http\Controllers\Api\V1\PrescriptionController;
use App\Http\Controllers\Api\V1\ReconciliationController;
use App\Http\Controllers\Api\V1\RiderDeliveryController;
use App\Http\Controllers\Api\V1\SubstitutionController;
use App\Http\Controllers\Api\V1\TenantController;
use App\Http\Controllers\Webhooks\AggregatorWebhookController;
use App\Http\Middleware\BindTenantContext;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API routes
|--------------------------------------------------------------------------
|
| The only product surface. backend/ serves JSON and WebSocket frames; it
| renders no product UI.
|
| Every /v1 route runs behind ResolveTenant and BindTenantContext, so no
| handler can execute a query without row-level security scoped to a tenant.
| Tenant identity comes from the request host or the authenticated session and
| NEVER from a path segment, query parameter or body field.
|
| @see docs/40-api/api-conventions.md
| @see docs/40-api/endpoint-catalogue.md
|
*/

Route::prefix('v1')->name('api.v1.')->group(function () {
    // Public: the patient portal needs branding before anyone signs in.
    Route::get('tenant', [TenantController::class, 'show'])->name('tenant.show');
    Route::get('consent-policies/current', [ConsentController::class, 'currentPolicy'])
        ->name('consent.policy');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', fn (Request $request) => $request->user())->name('me');

        // --- Patients and consent (H2) ---------------------------------
        Route::apiResource('patients', PatientController::class)->except(['destroy']);
        Route::get('patients/{patient}/consents', [ConsentController::class, 'index'])->name('consents.index');
        Route::post('patients/{patient}/consents', [ConsentController::class, 'store'])->name('consents.store');
        Route::post('patients/{patient}/consents/withdraw', [ConsentController::class, 'withdraw'])
            ->name('consents.withdraw');

        // --- Scheduling and consultations (H3) --------------------------
        Route::apiResource('appointments', AppointmentController::class)->except(['destroy', 'update']);
        Route::post('appointments/{appointment}/cancel', [AppointmentController::class, 'cancel'])
            ->name('appointments.cancel');
        Route::post('appointments/{appointment}/confirm-deferred', [AppointmentController::class, 'confirmDeferred'])
            ->name('appointments.confirm-deferred');

        Route::apiResource('consultations', ConsultationController::class)->only(['store', 'show']);
        Route::post('consultations/{consultation}/mode', [ConsultationController::class, 'recordMode'])
            ->name('consultations.mode');
        Route::post('consultations/{consultation}/end', [ConsultationController::class, 'end'])
            ->name('consultations.end');
        Route::get('consultations/{consultation}/notes', [ClinicalNoteController::class, 'index'])->name('notes.index');
        Route::post('consultations/{consultation}/notes', [ClinicalNoteController::class, 'store'])->name('notes.store');
        // Creates an ADDENDUM. Never overwrites -- a medical record that can be
        // silently rewritten is not a medical record.
        Route::patch('consultations/{consultation}/notes/{note}', [ClinicalNoteController::class, 'addendum'])
            ->name('notes.addendum');

        // --- Prescriptions (H3) -----------------------------------------
        // No PUT/PATCH: prescriptions are immutable after issue.
        Route::apiResource('prescriptions', PrescriptionController::class)->only(['index', 'store', 'show']);
        Route::post('prescriptions/{prescription}/cancel', [PrescriptionController::class, 'cancel'])
            ->name('prescriptions.cancel');

        // --- Dispensing (H4) --------------------------------------------
        Route::apiResource('dispense-orders', DispenseOrderController::class)->only(['index', 'show']);
        Route::post('dispense-orders/{dispenseOrder}/open', [DispenseOrderController::class, 'open'])->name('dispensing.open');
        Route::post('dispense-orders/{dispenseOrder}/price', [DispenseOrderController::class, 'price'])->name('dispensing.price');
        Route::post('dispense-orders/{dispenseOrder}/dispense', [DispenseOrderController::class, 'dispense'])->name('dispensing.dispense');
        Route::post('dispense-orders/{dispenseOrder}/reject', [DispenseOrderController::class, 'reject'])->name('dispensing.reject');
        Route::post('dispense-orders/{dispenseOrder}/substitutions', [SubstitutionController::class, 'store'])
            ->name('substitutions.store');
        // Only a clinician decides. There is no auto-approval.
        Route::post('substitutions/{substitution}/approve', [SubstitutionController::class, 'approve'])
            ->name('substitutions.approve');
        Route::post('substitutions/{substitution}/reject', [SubstitutionController::class, 'reject'])
            ->name('substitutions.reject');

        // --- Delivery (H4) ----------------------------------------------
        Route::apiResource('deliveries', DeliveryController::class)->only(['index', 'store', 'show']);
        Route::post('deliveries/{delivery}/assign', [DeliveryController::class, 'assign'])->name('deliveries.assign');
        Route::get('deliveries/{delivery}/tracking', [DeliveryController::class, 'tracking'])->name('deliveries.tracking');

        /*
         * The rider surface.
         *
         * A separate namespace with its own controller and its own resource
         * class carrying NO clinical fields -- not the dispatcher's routes with
         * fields hidden client-side.
         */
        Route::prefix('rider')->name('rider.')->group(function () {
            Route::get('deliveries', [RiderDeliveryController::class, 'index'])->name('deliveries.index');
            Route::get('deliveries/{delivery}', [RiderDeliveryController::class, 'show'])->name('deliveries.show');
            Route::post('deliveries/{delivery}/status', [RiderDeliveryController::class, 'updateStatus'])
                ->name('deliveries.status');
        });

        // --- Payments (H5) ----------------------------------------------
        // Idempotency-Key required on store.
        Route::post('payment-intents', [PaymentIntentController::class, 'store'])->name('payments.store');
        Route::get('payment-intents/{paymentIntent}', [PaymentIntentController::class, 'show'])->name('payments.show');
        Route::post('payment-intents/{paymentIntent}/attest-cash', [PaymentIntentController::class, 'attestCash'])
            ->name('payments.attest-cash');
        Route::get('reconciliation', [ReconciliationController::class, 'index'])->name('reconciliation.index');
    });
});

/*
|--------------------------------------------------------------------------
| Inbound aggregator webhooks
|--------------------------------------------------------------------------
|
| Unauthenticated -- the aggregator has no session with us. Trust comes
| ENTIRELY from signature verification against the tenant's own webhook secret,
| performed on the RAW body with a constant-time comparison.
|
| The tenant appears in the path because a webhook arrives with no host-based
| context and no session. It is NOT trusted until the signature verifies
| against that tenant's secret.
|
| @see docs/40-api/webhooks.md
|
*/
Route::post('webhooks/{provider}/{tenant}', AggregatorWebhookController::class)
    ->name('webhooks.aggregator')
    ->withoutMiddleware([
        ResolveTenant::class,
        BindTenantContext::class,
    ]);
