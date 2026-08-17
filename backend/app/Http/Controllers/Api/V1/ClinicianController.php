<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\ClinicianResource;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Who a patient can ask to see.
 *
 * PATIENT-FACING, and shaped by that. The response carries a name, a specialty
 * and a photo -- what a person needs to choose someone -- and nothing else.
 * ClinicianResource is where the omissions are enforced and explained; the one
 * that matters most is the registration number, which never appears here.
 *
 * There is no platform-level clinician and no cross-clinic directory. Every
 * clinician in this list is engaged by THIS clinic. Carevelo does not employ or
 * contract clinicians, and a searchable practitioner index across tenants would
 * be exactly the marketplace we must not build.
 *
 * @see docs/10-product/non-goals.md
 * @see docs/40-api/endpoint-catalogue.md
 */
class ClinicianController extends Controller
{
    /**
     * @var list<ClinicalRole>
     */
    private const READERS = [
        ClinicalRole::ClinicAdmin,
        ClinicalRole::Clinician,
        ClinicalRole::FrontDesk,
        ClinicalRole::Patient,
    ];

    /**
     * The clinic's clinicians, alphabetically.
     *
     * Returned whole rather than paginated: a private Ugandan clinic has a
     * handful of clinicians, and a patient choosing one needs to see them all.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->permitted($request);

        $clinicians = Clinician::query()
            // A deactivated staff account means the clinician has left. Listing
            // them lets a patient book someone who will not be there -- so the
            // filter is a correctness rule, not tidiness.
            ->whereIn('user_id', User::query()->where('is_active', true)->select('id'))
            ->with('user')
            ->orderBy('id')
            ->get()
            ->sortBy(static fn (Clinician $clinician): string => (string) $clinician->user?->name)
            ->values();

        return ClinicianResource::collection($clinicians);
    }

    /**
     * Default deny.
     *
     * A role check rather than a policy: this is one tenant-wide list with no
     * per-row decision to make, and Clinician has no policy of its own.
     * Deliberately excludes the rider and the dispatcher -- neither chooses a
     * clinician, and a practitioner list is not something to hand out for free.
     *
     * @throws AuthorizationException
     */
    private function permitted(Request $request): User
    {
        $user = $request->user();

        if ($user instanceof User && $user->is_active && $user->hasAnyRole(array_map(
            static fn (ClinicalRole $role): string => $role->value,
            self::READERS,
        ))) {
            return $user;
        }

        throw new AuthorizationException;
    }
}
