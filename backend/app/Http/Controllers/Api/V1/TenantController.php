<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\TenantResource;
use App\Models\Tenant;
use Illuminate\Http\Request;

class TenantController extends Controller
{
    /**
     * The current clinic's branding and contact details.
     *
     * Public: the patient portal needs this before anyone signs in, so it can
     * render the clinic's brand in the first HTML byte rather than flashing
     * Carevelo's.
     *
     * The tenant comes from ResolveTenant, never from the request — an unknown
     * host has already returned a neutral 404 by the time this runs.
     */
    public function show(Request $request): TenantResource
    {
        /** @var Tenant $tenant */
        $tenant = $request->attributes->get('tenant');

        return new TenantResource($tenant);
    }
}
