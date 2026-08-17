<?php

use App\Http\Controllers\Api\Admin\AggregatorAccountController;
use App\Http\Controllers\Api\Admin\ServiceController;
use App\Http\Controllers\Api\Admin\StaffController;
use App\Http\Controllers\Api\Admin\TenantAdminController;
use App\Http\Controllers\Api\Admin\WorkingHoursController;
use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\Auth\InvitationController;
use App\Http\Controllers\Api\Auth\OtpController;
use App\Http\Controllers\Api\Platform\BreakGlassController;
use App\Http\Controllers\Api\Platform\PlatformTenantController;
use App\Http\Controllers\Api\V1\AppointmentController;
use App\Http\Controllers\Api\V1\AuditEventController;
use App\Http\Controllers\Api\V1\AvailabilityController;
use App\Http\Controllers\Api\V1\ClinicalNoteController;
use App\Http\Controllers\Api\V1\ClinicianController;
use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Controllers\Api\V1\ConsultationController;
use App\Http\Controllers\Api\V1\DeliveryController;
use App\Http\Controllers\Api\V1\DispenseOrderController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\PatientController;
use App\Http\Controllers\Api\V1\PaymentIntentController;
use App\Http\Controllers\Api\V1\PrescriptionController;
use App\Http\Controllers\Api\V1\ReconciliationController;
use App\Http\Controllers\Api\V1\RiderDeliveryController;
use App\Http\Controllers\Api\V1\SubstitutionController;
use App\Http\Controllers\Api\V1\TenantController;
use App\Http\Controllers\HealthController;
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

    /*
     * Authentication.
     *
     * Public by necessity. Responses are ENUMERATION-SAFE: identical body and
     * equalised timing whether or not the number is registered, because
     * confirming that a phone belongs to a specific clinic discloses that the
     * person is a patient there -- itself health-adjacent information.
     *
     * @see docs/40-api/authentication-and-sessions.md
     */
    Route::post('auth/otp/request', [OtpController::class, 'request'])->name('auth.otp.request');
    Route::post('auth/otp/verify', [OtpController::class, 'verify'])->name('auth.otp.verify');
    Route::post('auth/sign-in', [AuthController::class, 'signIn'])->name('auth.sign-in');
    Route::post('invitations/{token}/accept', [InvitationController::class, 'accept'])
        ->name('invitations.accept');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', fn (Request $request) => $request->user())->name('me');
        Route::post('auth/sign-out', [AuthController::class, 'signOut'])->name('auth.sign-out');
        // Invalidates every other session for this user.
        Route::post('me/password', [AuthController::class, 'updatePassword'])->name('me.password');

        // --- Patients and consent (H2) ---------------------------------
        Route::apiResource('patients', PatientController::class)->except(['destroy']);
        Route::get('patients/{patient}/consents', [ConsentController::class, 'index'])->name('consents.index');
        Route::post('patients/{patient}/consents', [ConsentController::class, 'store'])->name('consents.store');
        Route::post('patients/{patient}/consents/withdraw', [ConsentController::class, 'withdraw'])
            ->name('consents.withdraw');

        /*
         * H1 clinic onboarding, administrator only.
         *
         * The aggregator account is the piece without which no clinic can take
         * a payment. Credentials are WRITE-ONLY: never returned by any
         * response, never logged, envelope-encrypted at rest.
         */
        Route::patch('tenant', [TenantAdminController::class, 'update'])->name('tenant.update');
        Route::post('tenant/logo', [TenantAdminController::class, 'uploadLogo'])->name('tenant.logo');
        Route::get('tenant/onboarding-checklist', [TenantAdminController::class, 'checklist'])
            ->name('tenant.checklist');

        Route::get('tenant/users', [StaffController::class, 'index'])->name('staff.index');
        Route::post('tenant/users/invite', [StaffController::class, 'invite'])->name('staff.invite');
        Route::patch('tenant/users/{user}', [StaffController::class, 'update'])->name('staff.update');

        Route::get('tenant/aggregator-account', [AggregatorAccountController::class, 'show'])
            ->name('aggregator.show');
        Route::put('tenant/aggregator-account', [AggregatorAccountController::class, 'update'])
            ->name('aggregator.update');
        Route::post('tenant/aggregator-account/verify', [AggregatorAccountController::class, 'verify'])
            ->name('aggregator.verify');

        Route::apiResource('services', ServiceController::class)->except(['show']);
        Route::get('working-hours', [WorkingHoursController::class, 'index'])->name('working-hours.index');
        Route::put('working-hours', [WorkingHoursController::class, 'update'])->name('working-hours.update');

        // --- Catalogue reads, patient-facing ----------------------------
        Route::get('availability', [AvailabilityController::class, 'index'])->name('availability.index');
        Route::get('clinicians', [ClinicianController::class, 'index'])->name('clinicians.index');

        // Within a tenant only. Never across -- the isolation boundary is
        // absolute, and merging across it is not a supported operation.
        Route::post('patients/{patient}/merge', [PatientController::class, 'merge'])->name('patients.merge');

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
        // Short-lived signed URL issued after an authorisation check. Never a
        // public or guessable path.
        Route::get('prescriptions/{prescription}/document', [PrescriptionController::class, 'document'])
            ->name('prescriptions.document');

        // --- Dispensing (H4) --------------------------------------------
        Route::apiResource('dispense-orders', DispenseOrderController::class)->only(['index', 'show']);
        Route::post('dispense-orders/{dispenseOrder}/open', [DispenseOrderController::class, 'open'])->name('dispensing.open');
        Route::post('dispense-orders/{dispenseOrder}/price', [DispenseOrderController::class, 'price'])->name('dispensing.price');
        Route::post('dispense-orders/{dispenseOrder}/dispense', [DispenseOrderController::class, 'dispense'])->name('dispensing.dispense');
        Route::post('dispense-orders/{dispenseOrder}/reject', [DispenseOrderController::class, 'reject'])->name('dispensing.reject');
        // The patient chooses pickup or delivery; delivery_disclosure consent
        // is captured HERE, not pre-emptively at registration.
        Route::post('dispense-orders/{dispenseOrder}/fulfilment', [DispenseOrderController::class, 'fulfilment'])
            ->name('dispensing.fulfilment');
        Route::post('dispense-orders/{dispenseOrder}/collect', [DispenseOrderController::class, 'collect'])
            ->name('dispensing.collect');
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
        // Names the CLINIC as payee. Carevelo is not a payee.
        Route::get('payment-intents/{paymentIntent}/receipt', [PaymentIntentController::class, 'receipt'])
            ->name('payments.receipt');
        Route::get('reconciliation', [ReconciliationController::class, 'index'])->name('reconciliation.index');
        Route::get('reconciliation/export', [ReconciliationController::class, 'export'])
            ->name('reconciliation.export');

        // --- Notifications and audit ------------------------------------
        Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
        Route::get('notification-templates', [NotificationController::class, 'templates'])
            ->name('notifications.templates');
        Route::get('sms-balance', [NotificationController::class, 'smsBalance'])->name('notifications.sms-balance');
        // Read-only, tenant-scoped. A clinic sees only its own trail, and
        // reading it is itself audited.
        Route::get('audit-events', [AuditEventController::class, 'index'])->name('audit-events.index');
    });
});

/*
|--------------------------------------------------------------------------
| Platform administration
|--------------------------------------------------------------------------
|
| Cross-tenant, and deliberately weak on clinical data. Platform operators
| reach tenant ADMINISTRATION but no clinical record without an active
| break-glass grant -- each clinic is the data controller, and we process only
| on its instruction.
|
| Not behind ResolveTenant: these routes operate ACROSS tenants by definition,
| so there is no single tenant to resolve from the host.
|
| @see docs/50-security-compliance/rbac-matrix.md
|
*/
Route::prefix('v1/platform')->name('api.v1.platform.')
    ->middleware('auth:sanctum')
    ->withoutMiddleware([ResolveTenant::class, BindTenantContext::class])
    ->group(function () {
        Route::get('tenants', [PlatformTenantController::class, 'index'])->name('tenants.index');
        Route::post('tenants', [PlatformTenantController::class, 'store'])->name('tenants.store');
        Route::patch('tenants/{tenant}', [PlatformTenantController::class, 'update'])->name('tenants.update');
        // A controller obligation we enable, not a courtesy: the clinic must
        // leave with its data, regardless of any commercial dispute.
        Route::post('tenants/{tenant}/export', [PlatformTenantController::class, 'export'])->name('tenants.export');
        Route::get('health', [PlatformTenantController::class, 'health'])->name('health');

        // Time-boxed, reason-recorded, TENANT-NOTIFIED, audited.
        Route::post('break-glass', [BreakGlassController::class, 'store'])->name('break-glass.store');
        Route::get('break-glass', [BreakGlassController::class, 'index'])->name('break-glass.index');
    });

/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
|
| /health/isolation is a SECURITY check, not an uptime check. It asserts the
| application role cannot bypass row-level security and owns no table -- the
| failure that is otherwise silent and total, because a system with inert RLS
| policies works perfectly and protects nothing.
|
| @see docs/30-architecture/observability.md
|
*/
Route::prefix('health')->name('health.')
    ->withoutMiddleware([ResolveTenant::class, BindTenantContext::class])
    ->group(function () {
        Route::get('live', [HealthController::class, 'live'])->name('live');
        Route::get('ready', [HealthController::class, 'ready'])->name('ready');
        Route::get('isolation', [HealthController::class, 'isolation'])->name('isolation');
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
