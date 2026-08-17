<?php

namespace App\Http\Controllers\Api\Platform;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Platform\IndexTenantRequest;
use App\Http\Requests\Platform\StoreTenantRequest;
use App\Http\Requests\Platform\UpdateTenantRequest;
use App\Http\Resources\Platform\PlatformTenantResource;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Services\Platform\PlatformHealth;
use App\Services\Platform\TenantExport;
use App\Tenancy\Tenancy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Date;
use Symfony\Component\HttpFoundation\Response;

/**
 * Platform administration: the tenant register, nothing behind it.
 *
 * These routes run WITHOUT ResolveTenant and BindTenantContext — they are
 * cross-tenant by definition, so there is no host to resolve a tenant from and
 * no row-level security context bound. Two consequences follow, and both are
 * deliberate:
 *
 *   1. Every query for a clinic's own rows returns NOTHING here. Reaching them
 *      takes an explicit Tenancy::run(), which appears exactly once in this
 *      controller's dependencies — in TenantExport, for the offboarding
 *      obligation.
 *   2. Audit events written from these handlers carry a null tenant_id and live
 *      in the platform trail, which is retained permanently for tenant
 *      lifecycle events.
 *
 * @see docs/50-security-compliance/rbac-matrix.md administration table
 */
class PlatformTenantController extends Controller
{
    public function __construct(protected AuditLog $audit) {}

    /**
     * The tenant register.
     *
     * What support can answer from here: is this clinic provisioned, on trial,
     * suspended, offboarding. What it cannot answer from anywhere: anything
     * about a patient.
     */
    public function index(IndexTenantRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Tenant::class);

        $status = $request->status();

        $tenants = Tenant::query()
            ->when(
                $status !== null,
                fn (Builder $query) => $query->where('status', $status),
            )
            ->orderBy('legal_name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage());

        return PlatformTenantResource::collection($tenants);
    }

    /**
     * Provision a clinic.
     *
     * Created in `provisioning`, never `active`. Onboarding is not finished
     * until the clinic has its own aggregator account, its services and at
     * least one administrator — and the clinic completes that itself.
     */
    public function store(StoreTenantRequest $request): JsonResponse
    {
        $this->authorize('create', Tenant::class);

        $attributes = $request->validated();

        $tenant = Tenant::create([
            ...$attributes,

            // The slug is the subdomain. Both are immutable and both name the
            // same clinic; two independently chosen values would be two things
            // to keep in step forever, for no gain.
            'slug' => $attributes['subdomain'],
            'status' => TenantStatus::Provisioning,
        ]);

        $this->audit->record(
            'tenant.provisioned',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
            metadata: ['subdomain' => $tenant->subdomain],
        );

        return (new PlatformTenantResource($tenant))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /**
     * Suspend, reactivate, begin offboarding.
     *
     * COMMERCIAL, never clinical. TenantStatus decides which moves are legal and
     * throws otherwise, which is why there is no transition table restated here.
     *
     * Suspension blocks staff sign-in. It does not reach into the clinical
     * surfaces: a patient still reads their own records, and a delivery already
     * in flight still completes. A commercial dispute must not become a clinical
     * incident.
     */
    public function update(UpdateTenantRequest $request, Tenant $tenant): PlatformTenantResource
    {
        $this->authorize('update', $tenant);

        $status = $request->status();
        $previous = $tenant->status;

        if ($status !== null && $status !== $previous) {
            $previous->assertCanTransitionTo($status);
            $tenant->status = $status;
        }

        if ($request->has('trial_ends_at')) {
            $trialEndsAt = $request->validated('trial_ends_at');
            $tenant->trial_ends_at = is_string($trialEndsAt) ? Date::parse($trialEndsAt) : null;
        }

        $tenant->save();

        if ($status !== null && $status !== $previous) {
            $this->audit->record(
                'tenant.status_changed',
                subjectType: 'Tenant',
                subjectId: $tenant->id,
                metadata: ['from' => $previous->value, 'to' => $status->value],
            );
        }

        return new PlatformTenantResource($tenant);
    }

    /**
     * The offboarding export.
     *
     * Deliberately reachable for a suspended tenant. The clinic is the data
     * controller and leaves with its data REGARDLESS of any commercial dispute;
     * withholding it to secure payment would be unlawful and would harm
     * patients. There is no status check here and there must never be one.
     *
     * Audited twice on purpose: once in the platform trail, and once in the
     * clinic's own, so the clinic can see that the export happened even when
     * someone else asked for it.
     */
    public function export(Tenant $tenant, TenantExport $export, Tenancy $tenancy): JsonResponse
    {
        $this->authorize('export', $tenant);

        $payload = $export->for($tenant);

        /** @var array<string, int> $counts */
        $counts = $payload['counts'];

        $this->audit->record(
            'tenant.exported',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
            metadata: ['record_counts' => $counts],
        );

        // The clinic's own trail. RLS is unbound on these routes, so writing
        // into it requires entering the tenant's context explicitly.
        $tenancy->run($tenant->id, fn () => $this->audit->record(
            'tenant.exported',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
            metadata: ['record_counts' => $counts],
        ));

        return new JsonResponse(['data' => $payload]);
    }

    /**
     * System health for a platform operator.
     *
     * Counts and one security assertion. No clinic is singled out, and nothing
     * here is about a person.
     */
    public function health(PlatformHealth $health): JsonResponse
    {
        $this->authorize('viewHealth', Tenant::class);

        return new JsonResponse(['data' => $health->snapshot()]);
    }
}
