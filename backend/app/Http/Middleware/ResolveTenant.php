<?php

namespace App\Http\Middleware;

use App\Audit\AuditLog;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Tenancy\Tenancy;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the current tenant, before any query runs.
 *
 * The tenant comes from the request HOST or the authenticated session, and
 * from nowhere else. It is never taken from a path segment, query parameter,
 * header or body field — a client-supplied tenant id would be a
 * client-controlled authorisation decision, which is the entire vulnerability
 * class the database layer exists to defeat.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
class ResolveTenant
{
    public function __construct(
        protected TenantContext $context,
        protected AuditLog $audit,
        protected Tenancy $tenancy,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $this->fromHost($request);

        if ($tenant === null) {
            // Neutral 404. Never confirm or deny that a clinic uses Carevelo:
            // enumerating the customer list should not be a loop over
            // subdomains, and the fact that a person is a patient of a specific
            // clinic is itself health-adjacent information.
            abort(404);
        }

        $user = $request->user();

        if ($user !== null && $user->tenant_id !== null && $user->tenant_id !== $tenant->id) {
            // A session belonging to one tenant arriving on another tenant's
            // host means either a bug or an attack. Both deserve a record.
            // Attributed to the tenant whose host was targeted, so the affected
            // clinic sees it in its own audit trail. Written through
            // Tenancy::run() because the database session is not bound yet --
            // BindTenantContext has not run, and RLS WITH CHECK would reject
            // the insert otherwise.
            $this->tenancy->run(
                $tenant->id,
                fn () => $this->audit->record('tenant.host_mismatch', metadata: [
                    'session_tenant_id' => $user->tenant_id,
                    'host_tenant_id' => $tenant->id,
                ])
            );

            abort(403);
        }

        // Suspension blocks staff sign-in but is a commercial action, never a
        // clinical one. It must not stop a patient reading their own records or
        // a delivery already in flight, so resolution still succeeds here and
        // the restriction is applied by policy.
        if ($tenant->status === TenantStatus::Closed) {
            abort(404);
        }

        $this->context->set($tenant->id);
        $request->attributes->set('tenant', $tenant);

        return $next($request);
    }

    /**
     * Look the tenant up by request host.
     *
     * Matches a custom domain first, then the subdomain of the application's
     * own domain.
     */
    protected function fromHost(Request $request): ?Tenant
    {
        $host = strtolower($request->getHost());

        $tenant = Tenant::query()->where('custom_domain', $host)->first();

        if ($tenant !== null) {
            return $tenant;
        }

        $appHost = strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST));

        if ($appHost !== '' && str_ends_with($host, '.'.$appHost)) {
            $subdomain = substr($host, 0, -(strlen($appHost) + 1));

            return Tenant::query()->where('subdomain', $subdomain)->first();
        }

        return null;
    }
}
