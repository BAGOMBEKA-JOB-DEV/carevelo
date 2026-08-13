<?php

use App\Http\Controllers\Api\V1\TenantController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API routes
|--------------------------------------------------------------------------
|
| The only product surface. `backend/` serves JSON and WebSocket frames; it
| renders no product UI. See docs/70-decisions/0007-separate-backend-frontend-trees.md
|
| Every route here runs behind ResolveTenant and BindTenantContext, so no
| handler can execute a query without row-level security scoped to a tenant.
| Tenant identity comes from the request host or the authenticated session and
| never from a path segment, query parameter or body field.
|
| See docs/40-api/api-conventions.md and docs/40-api/endpoint-catalogue.md
|
*/

Route::prefix('v1')->name('api.v1.')->group(function () {
    // Public: the patient portal needs branding before anyone signs in.
    Route::get('tenant', [TenantController::class, 'show'])->name('tenant.show');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', fn (Request $request) => $request->user())->name('me');
    });
});
