<?php

use App\Http\Controllers\Api\Admin\AggregatorAccountController;
use App\Http\Controllers\Api\Admin\ClinicianProfileController;
use App\Http\Controllers\Api\Admin\ServiceController;
use App\Http\Controllers\Api\Admin\StaffController;
use App\Http\Controllers\Api\Admin\TenantAdminController;
use App\Http\Controllers\Api\Admin\WorkingHoursController;
use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\Auth\InvitationController;
use App\Http\Controllers\Api\Platform\BreakGlassController;
use App\Http\Controllers\Api\Platform\PlatformSubscriptionController;
use App\Http\Controllers\Api\Platform\PlatformTenantController;
use App\Http\Controllers\Api\V1\AppointmentController;
use App\Http\Controllers\Api\V1\AuditEventController;
use App\Http\Controllers\Api\V1\AvailabilityController;
use App\Http\Controllers\Api\V1\ClinicalNoteController;
use App\Http\Controllers\Api\V1\ClinicianController;
use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Controllers\Api\V1\ConsultationController;
use App\Http\Controllers\Api\V1\ConsultationMessageController;
use App\Http\Controllers\Api\V1\DeliveryController;
use App\Http\Controllers\Api\V1\DispenseOrderController;
use App\Http\Controllers\Api\V1\JoinTokenController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\PatientAccountController;
use App\Http\Controllers\Api\V1\PatientController;
use App\Http\Controllers\Api\V1\PaymentIntentController;
use App\Http\Controllers\Api\V1\Platform\PlatformAuditEventController;
use App\Http\Controllers\Api\V1\Platform\PlatformAuthController;
use App\Http\Controllers\Api\V1\Platform\TotpEnrolmentController;
use App\Http\Controllers\Api\V1\PrescriptionController;
use App\Http\Controllers\Api\V1\ReconciliationController;
use App\Http\Controllers\Api\V1\RevenueController;
use App\Http\Controllers\Api\V1\RiderDeliveryController;
use App\Http\Controllers\Api\V1\SubstitutionController;
use App\Http\Controllers\Api\V1\TenantController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\Webhooks\AggregatorWebhookController;
use App\Http\Controllers\Webhooks\PesapalIpnController;
use App\Http\Controllers\Webhooks\PlatformBillingIpnController;
use App\Http\Middleware\BindTenantContext;
use App\Http\Middleware\RequirePasswordChange;
use App\Http\Middleware\RequireSecondFactor;
use App\Http\Middleware\ResolveTenant;
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
     * Authentication. One way in: an identifier and a password.
     *
     * The identifier is an email address or a phone number -- both, because a
     * clinic administrator at a desk expects to type an address and a clinician
     * between rooms has their number in hand. Everyone signs in the same way,
     * patients included.
     *
     * Public by necessity. Responses are ENUMERATION-SAFE: identical body,
     * identical status and equalised timing whether or not the identifier belongs
     * to an account here, because confirming that it does discloses that the
     * person is a patient of this clinic -- itself health-adjacent information.
     * The timing half is not incidental; see CredentialVerifier.
     *
     * @see docs/40-api/authentication-and-sessions.md
     */
    Route::post('auth/sign-in', [AuthController::class, 'signIn'])->name('auth.sign-in');
    Route::post('invitations/{token}/accept', [InvitationController::class, 'accept'])
        ->name('invitations.accept');

    /*
     * Everything behind a session.
     *
     * RequirePasswordChange sits immediately after authentication, and only
     * ever bites an account that did not choose its own password -- which today
     * means a patient account opened for them at the registration desk. While
     * that is outstanding the group refuses everything but the three routes
     * named in RequirePasswordChange::PERMITTED_ROUTES, because a staff member
     * who knows the password could otherwise sign in as the patient and forge a
     * consent decision the audit trail would attribute to them.
     *
     * @see docs/50-security-compliance/rbac-matrix.md
     */
    Route::middleware(['auth:sanctum', RequirePasswordChange::class])->group(function () {
        Route::get('me', [AuthController::class, 'me'])->name('me');
        Route::post('auth/sign-out', [AuthController::class, 'signOut'])->name('auth.sign-out');
        // Invalidates every other session for this user.
        Route::post('me/password', [AuthController::class, 'updatePassword'])->name('me.password');

        // --- Patients and consent (H2) ---------------------------------
        /*
         * PATCH only, not Laravel's default PUT|PATCH pair.
         *
         * These are partial updates, and PUT means "replace the whole resource".
         * On a patient record that is the wrong verb to leave open: a client
         * omitting a field would blank it. The catalogue says PATCH, and the
         * published contract now agrees -- with both registered, Scramble
         * documented `put` and the generated frontend client would have used it.
         */
        Route::apiResource('patients', PatientController::class)
            ->except(['destroy', 'update']);
        Route::patch('patients/{patient}', [PatientController::class, 'update'])->name('patients.update');
        /*
         * The patient's own way in, issued across the registration desk.
         *
         * POST only. There is no GET -- an endpoint whose job is answering
         * "does this person have an account here" is a question worth not
         * being able to ask, and the derived `has_account` flag on
         * PatientResource tells staff what they need while they are already
         * reading a record they are entitled to read. No DELETE either.
         *
         * The generated password is in the 201 body and nowhere else: not in
         * an SMS, not in the audit trail, not in a log line.
         */
        Route::post('patients/{patient}/account', [PatientAccountController::class, 'store'])
            ->name('patients.account.store');

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

        /*
         * The CLINICAL half of a staff record.
         *
         * An invitation produces an account in a role. A Clinician row is the
         * registration body, registration number and prescribing capability
         * that turn that account into a practitioner -- and until one exists
         * the clinic has nothing to offer: availability is generated per
         * Clinician, so no clinician means no slots, no booking, no
         * consultation and no prescription.
         *
         * Nested under the colleague rather than a top-level collection,
         * because it is one profile per person and the person is the thing
         * being administered. Administrator only, exactly like the staff
         * routes above it: setting `can_prescribe` and a registration number is
         * granting the right to prescribe, which the matrix keeps in the
         * `clinic_admin` column and nowhere else.
         *
         * There is no DELETE. A clinician who leaves is deactivated as staff.
         */
        Route::get('tenant/users/{user}/clinician', [ClinicianProfileController::class, 'show'])
            ->name('staff.clinician.show');
        Route::post('tenant/users/{user}/clinician', [ClinicianProfileController::class, 'store'])
            ->name('staff.clinician.store');
        Route::patch('tenant/users/{user}/clinician', [ClinicianProfileController::class, 'update'])
            ->name('staff.clinician.update');

        Route::get('tenant/aggregator-account', [AggregatorAccountController::class, 'show'])
            ->name('aggregator.show');
        Route::put('tenant/aggregator-account', [AggregatorAccountController::class, 'update'])
            ->name('aggregator.update');
        Route::post('tenant/aggregator-account/verify', [AggregatorAccountController::class, 'verify'])
            ->name('aggregator.verify');

        Route::apiResource('services', ServiceController::class)->except(['show', 'update']);
        Route::patch('services/{service}', [ServiceController::class, 'update'])->name('services.update');
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

        // Entry to the consultation itself. Issue hands the participant a
        // short-lived secret; redeem spends it and returns the provider
        // credentials. The token travels in the redeem BODY and never in a path,
        // because a URL is written to access logs and browser history.
        Route::post('appointments/{appointment}/join-token', [JoinTokenController::class, 'issue'])
            ->name('appointments.join-token');
        Route::post('join-tokens/redeem', [JoinTokenController::class, 'redeem'])
            ->name('consultations.join.redeem');

        // index as well as store and show: a clinician reviewing what they saw
        // last week, and an administrator answering a question about a past
        // encounter, both need the list. Cursor-paginated and audited like
        // every other read of a clinical record.
        Route::apiResource('consultations', ConsultationController::class)->only(['index', 'store', 'show']);
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

        /*
         * Consultation chat -- a clinical record, not ephemeral messaging.
         *
         * The fallback the threat model and the integrations document both
         * already promise for a video outage ("falls back to chat, which we
         * serve ourselves"), and the reason it sits here beside the notes rather
         * than in some messaging namespace: a message inside an encounter is
         * clinical text, subject to the same isolation, the same export and the
         * same break-glass as the notes it sits next to.
         *
         * Two verbs and no more. There is no PATCH and no DELETE, because a
         * conversation is corrected by saying something else.
         *
         * Both authorise ConsultationPolicy::participate -- the patient and the
         * conducting clinician, and nobody else. `conduct` would have locked the
         * patient out of their own consultation.
         */
        Route::get('consultations/{consultation}/messages', [ConsultationMessageController::class, 'index'])
            ->name('consultations.messages.index');
        Route::post('consultations/{consultation}/messages', [ConsultationMessageController::class, 'store'])
            ->name('consultations.messages.store');

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

        /*
         * "What did this clinic take?" -- answered at last, and labelled.
         *
         * The clinic console carried a placeholder where this screen belongs,
         * because the only figures the platform held were counts of ATTEMPTS and
         * summing those would have asserted that every attempt reported as
         * succeeded reached the clinic's account. Pesapal's GetTransactionStatus
         * supplies the missing observation -- a COMPLETED with a confirmation
         * code, refused unless the amount agrees with what we asked for -- so
         * there is now something real to report.
         *
         * The path says `revenue` because that is the question a clinic owner
         * arrives with. NOT ONE FIELD IN THE RESPONSE DOES: every figure is
         * `aggregator_confirmed_`, because money never passes through Carevelo
         * and nobody here can see the clinic's bank account. What the aggregator
         * confirmed and what reached the bank are different statements.
         *
         * Administrator only, on PaymentIntentPolicy::reconcile -- the same gate
         * as the reconciliation view beside it, reused rather than duplicated so
         * the two cannot drift apart.
         */
        Route::get('revenue', [RevenueController::class, 'index'])->name('revenue.index');

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
    /*
     * RequireSecondFactor SITS ON THE WHOLE GROUP, and that is the point of it.
     *
     * docs/40-api/authentication-and-sessions.md, acceptance criterion 5:
     * "Platform operators cannot authenticate without a second factor." That is
     * a statement about what a session can REACH, and the only place it can be
     * enforced as one is in front of every route the session might reach. A
     * per-route middleware list is a list somebody has to remember to add to,
     * and the failure mode of forgetting is a new cross-tenant endpoint
     * reachable with one factor -- with nothing visible about the failure: the
     * endpoint works, the tests pass, and the control is simply absent from one
     * door.
     *
     * It is deliberately the SECOND lock on the same door. PlatformAuthController
     * opens no session until a code has verified, so in the flow as it stands
     * this middleware refuses nothing. It holds if a later change ever
     * introduces another way to log a platform account in -- an impersonation
     * tool, a support "sign in as", a console command, a test helper reaching
     * for actingAs().
     */
    ->middleware(['auth:sanctum', RequireSecondFactor::class])
    ->withoutMiddleware([ResolveTenant::class, BindTenantContext::class])
    ->group(function () {
        /*
         * ---- Authentication, and the only routes in this file with no session ----
         *
         * A platform account has NO TENANT -- `tenant_id is null` is what makes
         * it one -- so `POST /v1/auth/sign-in` cannot serve it: that route is
         * inside the `v1` group behind ResolveTenant, which reads a tenant from
         * the host and 404s when the host is not a clinic's, and the controller
         * behind it scopes the account lookup to the resolved tenant. Signing in
         * on some clinic's subdomain to obtain a cross-tenant session is not a
         * workaround either: the same document defines a session whose tenant
         * does not match the host as a hard 403 and an audit event.
         *
         * So these live HERE, in the group that already runs without
         * ResolveTenant and BindTenantContext, and a platform sign-in resolves
         * no tenant and binds none.
         *
         * TWO STEPS. `sign-in` proves a password and returns no session at all;
         * `challenge` is the request that actually opens one. See
         * App\Support\Totp\SecondFactorSession for why the password step
         * issues nothing rather than issuing a narrowed session.
         *
         * Both drop `auth:sanctum` AND RequireSecondFactor, because there is no
         * session to authenticate at either point -- that is what they are for.
         * Being in this group rather than in one of their own is deliberate: a
         * sibling group with the same prefix is a second place platform routes
         * live, and the next one added would have to guess which.
         */
        Route::post('auth/sign-in', [PlatformAuthController::class, 'signIn'])
            ->name('auth.sign-in')
            ->withoutMiddleware(['auth:sanctum', RequireSecondFactor::class]);

        Route::post('auth/challenge', [PlatformAuthController::class, 'challenge'])
            ->name('auth.challenge')
            ->withoutMiddleware(['auth:sanctum', RequireSecondFactor::class]);

        // The one route RequireSecondFactor::PERMITTED_ROUTES lets an
        // authenticated-but-unverified session reach: somebody who cannot
        // proceed must still be able to close what they opened.
        Route::post('auth/sign-out', [PlatformAuthController::class, 'signOut'])->name('auth.sign-out');

        // The platform counterpart to GET /v1/me, which a platform operator
        // cannot reach -- that route is behind ResolveTenant and this surface's
        // host resolves to no clinic. Deliberately NOT exempted from
        // RequireSecondFactor: an account's name, address and platform roles are
        // not something to hand to whoever holds the password alone.
        Route::get('me', [PlatformAuthController::class, 'me'])->name('me');

        /*
         * ---- The second factor itself ----
         *
         * ROTATION, not first enrolment. Both are behind the group's
         * RequireSecondFactor, so the operator using them has already passed a
         * factor in this session. An enrolment endpoint reachable with a
         * password alone would be a password-only path to a second factor.
         *
         * First enrolment, and recovery for an operator who has lost their
         * authenticator, is `php artisan platform:enrol` -- out of band and
         * recorded, which is what the specification asks for.
         */
        Route::post('totp', [TotpEnrolmentController::class, 'store'])->name('totp.store');
        Route::post('totp/confirm', [TotpEnrolmentController::class, 'confirm'])->name('totp.confirm');

        Route::get('tenants', [PlatformTenantController::class, 'index'])->name('tenants.index');
        Route::post('tenants', [PlatformTenantController::class, 'store'])->name('tenants.store');
        Route::patch('tenants/{tenant}', [PlatformTenantController::class, 'update'])->name('tenants.update');
        // A controller obligation we enable, not a courtesy: the clinic must
        // leave with its data, regardless of any commercial dispute.
        Route::post('tenants/{tenant}/export', [PlatformTenantController::class, 'export'])->name('tenants.export');
        Route::get('health', [PlatformTenantController::class, 'health'])->name('health');

        /*
         * ---- The clinic's subscription to the software ----
         *
         * "Self-service plan selection and billing" was an explicit H1 non-goal
         * -- early plans are agreed in conversation, which is how this market
         * buys -- and the amendment in that PRD explains what changed. What has
         * not changed is WHO AGREES A PRICE: these routes are the platform's, an
         * operator records what was agreed, and there is deliberately no route
         * under `/v1/tenant` by which a clinic administrator could set its own
         * plan or its own price.
         *
         * CAREVELO IS THE MERCHANT for what these collect, and it is the only
         * place in the product where that is true. A clinic's own aggregator
         * account is unreachable from here: SubscriptionBilling takes platform
         * credentials from configuration and has no AggregatorAccount in scope.
         *
         * `collect` is separate from `subscription` on purpose. Recording a
         * commercial agreement and asking Pesapal for money are different acts,
         * and a support operator fixing a typo in a price must not thereby
         * charge a clinic.
         */
        Route::get('tenants/{tenant}/subscription', [PlatformSubscriptionController::class, 'show'])
            ->name('subscription.show');
        Route::put('tenants/{tenant}/subscription', [PlatformSubscriptionController::class, 'update'])
            ->name('subscription.update');
        Route::post('tenants/{tenant}/subscription/collect', [PlatformSubscriptionController::class, 'collect'])
            ->name('subscription.collect');

        // Time-boxed, reason-recorded, TENANT-NOTIFIED, audited.
        Route::post('break-glass', [BreakGlassController::class, 'store'])->name('break-glass.store');
        Route::get('break-glass', [BreakGlassController::class, 'index'])->name('break-glass.index');

        /*
         * ---- The evidence layer, read back ----
         *
         * Every control on this surface ends "and it is audited", and until this route
         * existed nothing could read any of it: platform events carry a null tenant_id,
         * `GET /v1/audit-events` is tenant-scoped by row-level security, and the isolation
         * policy on audit_events is disjoint in both directions. The break-glass grants
         * written two lines above, the tenant provisioning above that, the TOTP enrolments
         * and the platform sign-ins were all being written into a trail with no reader.
         *
         * GET only, and there is no route to a second method. No API writes an audit event
         * and nothing updates or deletes one -- the application role is denied UPDATE and
         * DELETE by grant.
         *
         * BEHIND RequireSecondFactor WITH THE REST OF THE GROUP, and pointedly not exempted.
         * This is the widest read surface in the product: one request reads across the
         * platform trail, and a named clinic's trail with it. If any route in this file
         * should not be the one that skips the gate, it is this one.
         *
         * A clinic's events come back as METADATA ONLY -- see PlatformAuditEventResource,
         * which withholds the payload, the record identifier and the staff member's address
         * and argues each one. That is what makes this endpoint different in kind from the
         * tenant route it superficially resembles, rather than the same query with the
         * scope taken off.
         */
        Route::get('audit-events', [PlatformAuditEventController::class, 'index'])
            ->name('audit-events.index');
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
| Inbound aggregator callbacks
|--------------------------------------------------------------------------
|
| Two providers, TWO SECURITY MODELS, and they are not variants of each other.
|
| Flutterwave signs its callbacks: trust comes ENTIRELY from verifying that
| signature against the tenant's own webhook secret, on the RAW body, with a
| constant-time comparison.
|
| Pesapal signs nothing and reports nothing. Its notification carries an
| OrderTrackingId and no status, deliberately, and there is no shared secret
| with which a signature could be verified even in principle. Trust there comes
| from NOTHING IN THE REQUEST: the tracking id locates an attempt inside one
| tenant, and the outcome is read back from Pesapal over TLS with that clinic's
| own credentials.
|
| The tenant appears in the path in both cases because a callback arrives with
| no host-based context and no session. It is not trusted for either provider.
|
| THE PESAPAL ROUTE IS DECLARED FIRST AND MUST STAY FIRST. Routes match in
| registration order, so `webhooks/{provider}/{tenant}` would otherwise swallow
| every POST to it and hand a Pesapal notification to the signature-verifying
| controller, which would reject it as unsigned -- a failure indistinguishable
| from a misconfigured clinic.
|
| GET and POST for Pesapal, because the notification type is registered per URL
| at Pesapal and both have been observed. Neither is trusted more than the other.
|
| @see docs/40-api/webhooks.md
| @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
|
*/
/*
 * CAREVELO'S OWN subscription revenue, and the only endpoint where the merchant
 * is us rather than a clinic.
 *
 * NO TENANT IN THE PATH, and that absence is the design. The clinic a recurring
 * transaction concerns is named by `subscription_transaction_info.
 * account_reference` in Pesapal's GetTransactionStatus RESPONSE -- the
 * `account_number` we set when the subscription was created -- and by nothing
 * in the request. A tenant segment here would be a field an anonymous caller
 * chooses, sitting next to a resolver that must not read one.
 *
 * Declared before `webhooks/pesapal/{tenant}` because reading it after would
 * invite the question. The two cannot actually collide -- two path segments
 * against three -- and a test asserts that a billing notification reaches this
 * controller rather than the per-clinic one, because "cannot collide" is a claim
 * about a router, and routers get reordered.
 *
 * GET and POST, like its neighbour: Pesapal registers a notification type per
 * URL and both have been observed. Neither is trusted more than the other,
 * because neither is trusted at all.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
Route::match(['get', 'post'], 'webhooks/pesapal-billing', PlatformBillingIpnController::class)
    ->name('webhooks.pesapal-billing')
    ->withoutMiddleware([
        ResolveTenant::class,
        BindTenantContext::class,
    ]);

Route::match(['get', 'post'], 'webhooks/pesapal/{tenant}', PesapalIpnController::class)
    ->name('webhooks.pesapal')
    ->withoutMiddleware([
        ResolveTenant::class,
        BindTenantContext::class,
    ]);

Route::post('webhooks/{provider}/{tenant}', AggregatorWebhookController::class)
    ->name('webhooks.aggregator')
    ->withoutMiddleware([
        ResolveTenant::class,
        BindTenantContext::class,
    ]);
