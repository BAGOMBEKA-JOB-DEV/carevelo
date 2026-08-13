<?php

use App\Http\Controllers\Api\V1\PaymentIntentController;
use App\Http\Controllers\Api\V1\RiderDeliveryController;
use App\Http\Controllers\Api\V1\TenantController;
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
| Every route runs behind ResolveTenant and BindTenantContext, so no handler
| can execute a query without row-level security scoped to a tenant. Tenant
| identity comes from the request host or the authenticated session and never
| from a path segment, query parameter or body field.
|
| @see docs/40-api/api-conventions.md
| @see docs/40-api/endpoint-catalogue.md
|
*/

Route::prefix('v1')->name('api.v1.')->group(function () {
    // Public: the patient portal needs branding before anyone signs in.
    Route::get('tenant', [TenantController::class, 'show'])->name('tenant.show');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', fn (Request $request) => $request->user())->name('me');

        /*
         * The rider surface.
         *
         * A separate namespace with its own controller and its own resource
         * class carrying no clinical fields -- not the dispatcher's routes
         * with fields hidden client-side.
         */
        Route::prefix('rider')->name('rider.')->group(function () {
            Route::get('deliveries', [RiderDeliveryController::class, 'index'])->name('deliveries.index');
            Route::get('deliveries/{delivery}', [RiderDeliveryController::class, 'show'])->name('deliveries.show');
            Route::post('deliveries/{delivery}/status', [RiderDeliveryController::class, 'updateStatus'])
                ->name('deliveries.status');
        });

        // Idempotency-Key required on store. See the controller.
        Route::post('payment-intents', [PaymentIntentController::class, 'store'])->name('payments.store');
        Route::get('payment-intents/{paymentIntent}', [PaymentIntentController::class, 'show'])->name('payments.show');
    });
});
