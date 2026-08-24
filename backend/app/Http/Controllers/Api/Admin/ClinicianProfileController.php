<?php

namespace App\Http\Controllers\Api\Admin;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Clinicians\StoreClinicianRequest;
use App\Http\Requests\Admin\Clinicians\UpdateClinicianRequest;
use App\Http\Resources\V1\ClinicianProfileResource;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The clinical profile that turns a colleague into a practitioner.
 *
 * A staff invitation produces a User in a role. That is an account, not a
 * clinician: a Clinician row is the registration body, registration number and
 * prescribing capability the PRD requires clinical roles to capture, and until
 * one exists the clinic has nobody the product can actually use.
 *
 * The consequence of that gap was not subtle. GET /v1/availability generates
 * slots per Clinician row, so a freshly onboarded clinic offered none; with no
 * slots there is nothing to book; with nothing to book there is no consultation
 * and therefore no prescription. The onboarding checklist has always had an "at
 * least one registered clinician" gate that is required for activation, and
 * before this endpoint nothing in the application could satisfy it.
 *
 * WHY THIS IS ADMINISTRATOR-ONLY. The RBAC matrix has one row for it:
 * "Staff -- invite / manage roles", permitted to `clinic_admin` and to nobody
 * else, audited as a first-class event. This is that row. Two of the three
 * fields here are capability grants rather than contact details -- the matrix's
 * own footnote on issuing a prescription reads "requires can_prescribe = true
 * AND a registration number", so writing those two IS granting the right to
 * prescribe. Letting a clinician write their own would make the single most
 * important invariant in the system self-service, exactly as letting an invited
 * colleague choose their own role would make the matrix advisory.
 *
 * There is no DELETE, for the reason services have none: appointments,
 * consultations and prescriptions point at this row, and removing it would
 * orphan a clinical history a clinic may have to produce years later. A
 * clinician who leaves is deactivated as a STAFF MEMBER, which the staff
 * endpoint already does and which the patient-facing clinician list already
 * honours by filtering on `is_active`.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md sections 6 and 8
 * @see docs/50-security-compliance/rbac-matrix.md
 * @see docs/20-domain/domain-model.md
 */
class ClinicianProfileController extends Controller
{
    public function __construct(protected AuditLog $audit) {}

    /**
     * Read back what the clinic recorded, registration number included.
     *
     * Separate from GET /v1/clinicians and shaped differently on purpose. That
     * one is patient-facing and omits the registration number permanently; this
     * one is the administrator reading back a field they typed, on a route only
     * they can reach, so they can correct it.
     */
    public function show(Request $request, User $user): ClinicianProfileResource
    {
        $tenant = $this->administeredTenant($request);

        return new ClinicianProfileResource(
            $this->existingProfile($this->clinicalColleague($user, $tenant))
        );
    }

    /**
     * Record a colleague's registration details.
     */
    public function store(StoreClinicianRequest $request, User $user): JsonResponse
    {
        $tenant = $this->administeredTenant($request);
        $this->clinicalColleague($user, $tenant);

        // One profile per person, which the (tenant_id, user_id) unique index
        // also enforces. Caught here so the administrator gets a sentence
        // telling them what to do instead of a constraint violation.
        if (Clinician::query()->where('user_id', $user->id)->exists()) {
            throw new IllegalTransition(
                'This colleague already has a clinical profile. Correct the existing one '
                .'rather than adding a second: everything already recorded under their name '
                .'points at it.'
            );
        }

        $registrationNumber = $this->registrationNumber($request->safe()->all(), '');
        $canPrescribe = (bool) ($request->safe()->all()['can_prescribe'] ?? false);

        $this->assertPrescribingIsSupportable($registrationNumber, $canPrescribe);

        $clinician = new Clinician($request->safe()->only([
            'registration_body', 'practising_licence_expires_at', 'specialty',
        ]));

        $clinician->user_id = $user->id;
        $clinician->registration_number = $registrationNumber;
        $clinician->can_prescribe = $canPrescribe;
        $clinician->save();

        $this->recordCreation($clinician);

        return (new ClinicianProfileResource($clinician->load('user')))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Correct or complete a clinical profile.
     *
     * The PRD's exception path lands here: a clinician saved without a
     * registration number carries `can_prescribe = false` and is prompted to
     * complete it before prescribing. This is where that prompt leads.
     */
    public function update(UpdateClinicianRequest $request, User $user): ClinicianProfileResource
    {
        $tenant = $this->administeredTenant($request);

        $clinician = $this->existingProfile($this->clinicalColleague($user, $tenant));

        $changes = $request->safe()->all();

        // The RESULTING state is what has to be coherent, not the payload. An
        // update that only switches prescribing on has to be judged against the
        // registration number already stored, and one that only blanks the
        // number has to be judged against the flag already set.
        $registrationNumber = $this->registrationNumber($changes, $clinician->registration_number);
        $canPrescribe = array_key_exists('can_prescribe', $changes)
            ? (bool) $changes['can_prescribe']
            : $clinician->can_prescribe;

        $this->assertPrescribingIsSupportable($registrationNumber, $canPrescribe);

        $clinician->fill($request->safe()->only([
            'registration_body', 'practising_licence_expires_at', 'specialty',
        ]));

        $clinician->registration_number = $registrationNumber;
        $clinician->can_prescribe = $canPrescribe;
        $clinician->save();

        $this->audit->record(
            'clinician.updated',
            subjectType: 'Clinician',
            subjectId: $clinician->id,
            // The FIELDS that moved, plus the capability, because a change to
            // prescribing rights is the security-relevant fact. Never the
            // registration number itself: a practitioner credential written into
            // an audit trail is a credential in a second place, and the audit log
            // records that something happened to which record, not what it said.
            metadata: [
                'user_id' => $clinician->user_id,
                'fields' => array_keys($changes),
                'can_prescribe' => $clinician->can_prescribe,
            ],
        );

        $this->warnOnExpiredLicence($clinician);

        return new ClinicianProfileResource($clinician->refresh()->load('user'));
    }

    /**
     * The staff member whose clinical profile is being addressed.
     *
     * Route model binding resolves User without tenant scoping -- authentication
     * has to find a user before a tenant is resolved, so User carries no global
     * scope and the users table has no row-level security to lean on. Another
     * clinic's staff member can therefore arrive here, and the answer is 404
     * rather than 403: a 403 confirms the account exists, which discloses that a
     * named person works at some other clinic on Carevelo.
     *
     * A patient account gets the same 404, for the same reason it does on the
     * staff endpoints -- it is not part of the collection being addressed. The
     * concrete stake is higher here than there: a Clinician row makes an account
     * BOOKABLE, and minting one from a patient account would put a patient in
     * the clinic's availability.
     *
     * A colleague in some other staff role is a different situation and gets a
     * different answer. They exist, they are addressable, and the refusal is a
     * domain rule -- so it is a 409 carrying the remedy, which is to change the
     * role first.
     */
    private function clinicalColleague(User $user, Tenant $tenant): User
    {
        abort_unless($user->belongsToTenant($tenant->id), 404);
        abort_if($user->hasRole(ClinicalRole::Patient->value), 404);

        if (! $user->hasRole(ClinicalRole::Clinician->value)) {
            throw new IllegalTransition(
                'A clinical profile belongs to a colleague in the clinician role. Change this '
                .'person\'s role first -- registration details on a pharmacist or a receptionist '
                .'would put them in the clinic\'s availability, where patients would book them.'
            );
        }

        return $user;
    }

    /**
     * The profile this colleague already has.
     *
     * 404 when there is none: the address `…/users/{user}/clinician` names a
     * thing that does not exist yet, and the remedy is POST, not permission.
     */
    private function existingProfile(User $user): Clinician
    {
        $clinician = Clinician::query()->where('user_id', $user->id)->with('user')->first();

        abort_if($clinician === null, 404);

        return $clinician;
    }

    /**
     * The registration number the profile will end up holding.
     *
     * Trimmed, and null collapsed to the empty string. The column is NOT NULL,
     * and `mayPrescribe()` asks whether the trimmed value is non-empty -- so a
     * number of three spaces must not read as a number anywhere.
     *
     * @param  array<string, mixed>  $changes
     */
    private function registrationNumber(array $changes, string $current): string
    {
        if (! array_key_exists('registration_number', $changes)) {
            return $current;
        }

        $value = $changes['registration_number'];

        return is_string($value) ? trim($value) : '';
    }

    /**
     * Prescribing rights cannot outrun the registration number behind them.
     *
     * THE invariant, restated at the boundary. `Clinician::mayPrescribe()`
     * already refuses to issue on a blank number, so nothing unsafe could
     * happen -- but a profile stored with the flag on and no number is an
     * incoherent record that an administrator's screen would render as "may
     * prescribe", and the first they would learn otherwise is a clinician
     * failing to prescribe with a patient waiting.
     *
     * Refusing here says it while the administrator is still on the screen, and
     * the message names the way through: save it off, turn it on when the number
     * is to hand.
     */
    private function assertPrescribingIsSupportable(string $registrationNumber, bool $canPrescribe): void
    {
        if ($canPrescribe && $registrationNumber === '') {
            throw new IllegalTransition(
                'A clinician cannot be given prescribing rights without a registration number. '
                .'Save the profile with prescribing off, and turn it on once the number is to hand.'
            );
        }
    }

    private function recordCreation(Clinician $clinician): void
    {
        $this->audit->record(
            'clinician.created',
            subjectType: 'Clinician',
            subjectId: $clinician->id,
            // Which register and whether they may prescribe -- the two facts a
            // later question about this grant would ask. Not the registration
            // number, not the specialty, and no clinical content of any kind.
            metadata: [
                'user_id' => $clinician->user_id,
                'registration_body' => $clinician->registration_body,
                'can_prescribe' => $clinician->can_prescribe,
            ],
        );

        $this->warnOnExpiredLicence($clinician);
    }

    /**
     * An expired practising licence is recorded, never enforced.
     *
     * The domain model is explicit: warn prominently, do not hard-block, and
     * record the warning as an audit event. Licence currency is the clinic's
     * regulatory responsibility; blocking care on our possibly-stale copy of a
     * register we cannot read would be the worse error, and the audit event is
     * what lets the clinic show it was told.
     */
    private function warnOnExpiredLicence(Clinician $clinician): void
    {
        if (! $clinician->hasExpiredLicence()) {
            return;
        }

        $this->audit->record(
            'clinician.licence_expired',
            subjectType: 'Clinician',
            subjectId: $clinician->id,
            metadata: [
                'user_id' => $clinician->user_id,
                'expired_at' => $clinician->practising_licence_expires_at?->toDateString(),
            ],
        );
    }

    /**
     * The clinic this administrator may administer.
     *
     * @see TenantAdminController::administeredTenant() for why this is an
     *      explicit check rather than a policy call
     *
     * @throws AuthorizationException
     */
    private function administeredTenant(Request $request): Tenant
    {
        $tenant = $request->attributes->get('tenant');
        $user = $request->user();

        if (! $tenant instanceof Tenant
            || ! $user instanceof User
            || ! $user->is_active
            || ! $user->belongsToTenant($tenant->id)
            || ! $user->hasRole(ClinicalRole::ClinicAdmin->value)) {
            throw new AuthorizationException;
        }

        return $tenant;
    }
}
