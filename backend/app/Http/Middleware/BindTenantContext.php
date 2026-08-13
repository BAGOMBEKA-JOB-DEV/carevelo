<?php

namespace App\Http\Middleware;

use App\Tenancy\Tenancy;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Applies the resolved tenant to the database session.
 *
 * Runs immediately after ResolveTenant and before the router dispatches, so no
 * controller can execute a query without row-level security scoped to a tenant.
 *
 * The whole request runs inside a transaction because the tenant setting is
 * transaction-scoped — which is also why any connection pooler must run in
 * transaction mode. In session mode a pooled connection could carry one
 * tenant's context into another tenant's request: a cross-tenant read with no
 * code defect at all.
 *
 * @see docs/30-architecture/multi-tenancy.md
 * @see docs/30-architecture/environments-and-deployment.md
 */
class BindTenantContext
{
    public function __construct(
        protected TenantContext $context,
        protected Tenancy $tenancy,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->context->has()) {
            // Reaching here without a resolved tenant means the middleware
            // stack is misordered. Failing loudly beats running unscoped.
            abort(400, 'No tenant resolved for this request.');
        }

        DB::beginTransaction();

        try {
            $this->tenancy->bind(DB::connection());

            $response = $next($request);

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();

            throw $e;
        } finally {
            $this->tenancy->forget();
        }

        return $response;
    }
}
