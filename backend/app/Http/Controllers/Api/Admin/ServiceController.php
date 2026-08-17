<?php

namespace App\Http\Controllers\Api\Admin;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Services\StoreServiceRequest;
use App\Http\Requests\Admin\Services\UpdateServiceRequest;
use App\Http\Resources\V1\ServiceResource;
use App\Models\ClinicalRole;
use App\Models\Service;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The clinic's own catalogue of bookable services.
 *
 * Prices are PER TENANT. There is no platform price list, no recommended fee
 * and no margin: a clinic in Gulu charging 20,000 for a follow-up and one in
 * Kampala charging 60,000 are both correctly configured, and Carevelo has no
 * opinion. Every amount is integer minor units through the Money value object,
 * never a float.
 *
 * Authorisation is a role check written out here rather than a policy. Service
 * is clinic CONFIGURATION, not a record about a person: there is no per-row
 * decision to make, no owner to compare against, and the four endpoints in this
 * module read from one of two role lists. A policy per row would be ceremony
 * around a constant. The check is still default-deny -- anything that is not on
 * a list below is refused.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class ServiceController extends Controller
{
    /**
     * Who may read the catalogue.
     *
     * Patients included, and necessarily: the booking flow is a list of
     * services with prices, and a patient who cannot see it cannot book.
     *
     * @var list<ClinicalRole>
     */
    private const READERS = [
        ClinicalRole::ClinicAdmin,
        ClinicalRole::Clinician,
        ClinicalRole::Pharmacist,
        ClinicalRole::FrontDesk,
        ClinicalRole::Patient,
    ];

    /**
     * Who sees deactivated services as well as live ones.
     *
     * @var list<ClinicalRole>
     */
    private const STAFF = [
        ClinicalRole::ClinicAdmin,
        ClinicalRole::Clinician,
        ClinicalRole::Pharmacist,
        ClinicalRole::FrontDesk,
    ];

    /**
     * Who may change what the clinic offers and what it costs.
     *
     * The administrator alone. A price is a commercial commitment to a patient.
     *
     * @var list<ClinicalRole>
     */
    private const MANAGERS = [ClinicalRole::ClinicAdmin];

    public function __construct(protected AuditLog $audit) {}

    /**
     * The catalogue.
     *
     * Returned whole rather than paginated: a clinic offers tens of services,
     * not thousands, and the client needs all of them at once to render a
     * picker. A cursor here would be a second round trip for nothing.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $this->permitted($request, self::READERS);

        $query = Service::query()->orderBy('name')->orderBy('id');

        // Patients see only what the clinic currently offers. A deactivated
        // service stays in the table because historical appointments point at
        // it, but publishing one would let a patient book care that has been
        // withdrawn -- and then arrive for it.
        if (! $this->hasAnyRole($user, self::STAFF)) {
            $query->where('is_active', true);
        }

        return ServiceResource::collection($query->get());
    }

    public function store(StoreServiceRequest $request): JsonResponse
    {
        $this->permitted($request, self::MANAGERS);

        $service = new Service($request->serviceAttributes());

        // Through the value object, so the two-column write belongs to the
        // Money cast and no controller ever touches price_minor by hand.
        $service->price = $request->price();
        $service->save();

        $this->recordPricing('service.created', $service);

        return (new ServiceResource($service))->response()->setStatusCode(201);
    }

    public function update(UpdateServiceRequest $request, Service $service): ServiceResource
    {
        $this->permitted($request, self::MANAGERS);

        $service->fill($request->serviceAttributes());

        if ($request->changesPrice()) {
            $service->price = $request->price();
        }

        $service->save();

        $this->recordPricing('service.updated', $service);

        return new ServiceResource($service);
    }

    /**
     * DELETE is a DEACTIVATION. The row is never removed.
     *
     * Appointments, and through them consultations and prescriptions, carry a
     * service_id. Deleting the row would orphan every one of them: a clinic
     * looking at last year's bookings would see a reference resolving to
     * nothing, and a foreign key would either refuse the delete or cascade the
     * history away. Neither is acceptable for a record a clinic may have to
     * produce years later.
     *
     * The verb stays DELETE because that is what a client means, and because
     * the observable effect -- it leaves the catalogue -- is the same.
     */
    public function destroy(Request $request, Service $service): ServiceResource
    {
        $this->permitted($request, self::MANAGERS);

        $service->is_active = false;
        $service->save();

        $this->audit->record(
            'service.deactivated',
            subjectType: 'Service',
            subjectId: $service->id,
        );

        return new ServiceResource($service);
    }

    /**
     * Audit a catalogue change.
     *
     * The price is recorded because it is a commercial fact a clinic may later
     * have to reconstruct in a billing dispute. The service NAME is not: a
     * service name is health information about whoever books it, and an audit
     * event records that something happened to which record, never what the
     * record said.
     */
    private function recordPricing(string $action, Service $service): void
    {
        $this->audit->record(
            $action,
            subjectType: 'Service',
            subjectId: $service->id,
            metadata: [
                'price_minor' => $service->price->amountMinor,
                'currency' => $service->price->currency->value,
                'is_active' => $service->is_active,
            ],
        );
    }

    /**
     * Default deny: only an active user holding one of `$roles` gets through.
     *
     * @param  list<ClinicalRole>  $roles
     *
     * @throws AuthorizationException
     */
    private function permitted(Request $request, array $roles): User
    {
        $user = $request->user();

        if ($user instanceof User && $this->hasAnyRole($user, $roles)) {
            return $user;
        }

        throw new AuthorizationException;
    }

    /** @param  list<ClinicalRole>  $roles */
    private function hasAnyRole(User $user, array $roles): bool
    {
        if (! $user->is_active) {
            return false;
        }

        return $user->hasAnyRole(array_map(
            static fn (ClinicalRole $role): string => $role->value,
            $roles,
        ));
    }
}
