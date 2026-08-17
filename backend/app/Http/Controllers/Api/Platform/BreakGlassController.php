<?php

namespace App\Http\Controllers\Api\Platform;

use App\Http\Controllers\Controller;
use App\Http\Requests\Platform\IndexBreakGlassGrantRequest;
use App\Http\Requests\Platform\StoreBreakGlassGrantRequest;
use App\Http\Resources\Platform\BreakGlassGrantResource;
use App\Models\BreakGlassGrant;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Platform\BreakGlassGrants;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

/**
 * The break-glass control surface.
 *
 * This controller creates and lists GRANTS. It serves no clinical record and
 * never will: reading a record under a grant goes through
 * App\Services\Platform\BreakGlassAccess, which re-checks the grant and audits
 * every single access. Keeping the two apart is what makes "each access is
 * audited" true rather than aspirational — an endpoint that both granted and
 * served would audit the grant once and the reads never.
 *
 * Approval by a second platform administrator is the intended control where
 * staffing allows. It is not implemented here, and that is named rather than
 * dressed up: with a small team every grant is effectively self-approved and
 * flagged for later review. The register below IS that review surface.
 *
 * @see docs/50-security-compliance/rbac-matrix.md break-glass section
 */
class BreakGlassController extends Controller
{
    /**
     * The grant register.
     *
     * Two readers, one list. A platform reviewer asks whether the count is
     * rising — a rising count means the metadata-based support tooling is
     * inadequate, not that access is needed. A clinic administrator asks what we
     * read of theirs and when, and the policy narrows the list to their own
     * tenant.
     */
    public function index(IndexBreakGlassGrantRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', BreakGlassGrant::class);

        /** @var User $reader */
        $reader = $request->user();

        $query = BreakGlassGrant::query()->orderByDesc('granted_at');

        // A clinic administrator reads only grants against their own clinic.
        // RLS cannot do this one: break_glass_grants is platform-scoped, because
        // the register has to be readable with no tenant bound.
        if (! $reader->isPlatformUser()) {
            $query->where('tenant_id', $reader->tenant_id);
        } elseif ($request->tenantId() !== null) {
            $query->where('tenant_id', $request->tenantId());
        }

        if ($request->onlyActive()) {
            $query->active();
        }

        return BreakGlassGrantResource::collection($query->cursorPaginate($request->perPage()));
    }

    /**
     * Request a grant.
     *
     * The grant is issued and the clinic is notified in one transaction. There
     * is no window in which access exists and the controller has not been told.
     */
    public function store(StoreBreakGlassGrantRequest $request, BreakGlassGrants $grants): JsonResponse
    {
        $this->authorize('create', BreakGlassGrant::class);

        /** @var User $operator */
        $operator = $request->user();

        $tenant = Tenant::query()->findOrFail($request->tenantId());

        $grant = $grants->issue(
            operator: $operator,
            tenant: $tenant,
            reason: $request->reason(),
            scope: $request->scope(),
            expiresAt: $request->expiresAt(),
        );

        return (new BreakGlassGrantResource($grant))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }
}
