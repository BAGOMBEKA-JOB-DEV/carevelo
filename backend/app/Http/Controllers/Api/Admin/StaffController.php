<?php

namespace App\Http\Controllers\Api\Admin;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Staff\InviteStaffRequest;
use App\Http\Requests\Admin\Staff\UpdateStaffRequest;
use App\Http\Resources\V1\StaffResource;
use App\Models\ClinicalRole;
use App\Models\StaffInvitation;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\TemplateRegistry;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Arr;

/**
 * The clinic's own staff list: who works here, in which role, and with access.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 6
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class StaffController extends Controller
{
    public function __construct(
        protected AuditLog $audit,
        protected Notifier $notifier,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $tenant = $this->administeredTenant($request);

        // Filtered on tenant_id EXPLICITLY. User deliberately does not use
        // BelongsToTenant -- authentication has to find a user before a tenant
        // is resolved -- so there is no global scope here to lean on, and no
        // row-level security on the users table either.
        $staff = User::query()
            ->where('tenant_id', $tenant->id)
            ->with('roles')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate(25);

        return StaffResource::collection($staff);
    }

    /**
     * Invite a colleague by phone.
     *
     * The invitation row holds a HASH of the token, never the token. It is a
     * bearer credential for as long as it lives -- whoever holds it can create
     * an account inside this clinic, in the role written here -- so a leaked
     * database backup must not be a set of usable invitations. The plaintext
     * leaves this method exactly once, in the SMS.
     */
    public function invite(InviteStaffRequest $request): JsonResponse
    {
        $this->administeredTenant($request);

        $validated = $request->validated();
        $name = (string) $validated['name'];
        $phone = (string) $validated['phone'];
        $role = ClinicalRole::from((string) $validated['role']);

        // Re-inviting the same number replaces the outstanding invitation rather
        // than stacking a second one. Two live tokens for one person is two
        // chances for the wrong one to be spent, potentially into two different
        // roles.
        StaffInvitation::query()
            ->where('phone', $phone)
            ->whereNull('accepted_at')
            ->delete();

        $administrator = $request->user();

        [$invitation, $token] = StaffInvitation::issue(
            $phone,
            $name,
            $role,
            $administrator instanceof User ? $administrator->id : null,
        );

        $this->notifier->send(TemplateRegistry::STAFF_INVITATION, $phone, [
            'setup_link' => $this->setupLink($token),
        ]);

        $this->audit->record(
            'staff.invited',
            subjectType: 'StaffInvitation',
            subjectId: $invitation->id,
            // The role, because that is the security-relevant fact. Never the
            // name or the number: an audit trail is not a contact list.
            metadata: ['role' => $role->value],
        );

        return response()->json([
            'data' => [
                'id' => $invitation->id,
                'role' => $invitation->role,
                'expires_at' => $invitation->expires_at->toIso8601String(),
                // Deliberately absent: the token. It exists in the SMS and
                // nowhere else -- not this response, not the audit event, not a
                // log line.
                'note' => 'An SMS invitation has been sent. It expires in '
                    .StaffInvitation::EXPIRES_AFTER_DAYS.' days.',
            ],
        ], 201);
    }

    /**
     * Correct a staff member's details, role or access.
     *
     * THE LAST ACTIVE ADMINISTRATOR CANNOT LOSE ADMINISTRATIVE ACCESS. Locking a
     * clinic out of its own tenant is a support incident we would have to fix
     * with database access, and it is worse than that: the clinic is the data
     * controller for every record inside, and a controller that cannot reach its
     * own data cannot answer a subject-access request or a regulator. So the
     * refusal is here rather than in the console, where a second client would
     * have to remember it.
     */
    public function update(UpdateStaffRequest $request, User $user): StaffResource
    {
        $tenant = $this->administeredTenant($request);

        // Route model binding resolves User without tenant scoping, and there is
        // no row-level security on the users table, so another clinic's staff
        // member can arrive here. 404 rather than 403: a 403 confirms the
        // account exists, which discloses that a given person works at some
        // other clinic on Carevelo.
        abort_unless($user->belongsToTenant($tenant->id), 404);

        $changes = $request->validated();

        $isBeingDeactivated = array_key_exists('is_active', $changes) && $changes['is_active'] === false;
        $isLosingAdminRole = array_key_exists('role', $changes)
            && $changes['role'] !== ClinicalRole::ClinicAdmin->value;

        if (($isBeingDeactivated || $isLosingAdminRole) && $this->isLastActiveAdministrator($user, $tenant->id)) {
            throw new IllegalTransition(
                'This is the clinic\'s last active administrator. Invite or promote another '
                .'administrator first -- otherwise nobody can reach this clinic\'s settings, '
                .'staff list or patient records.'
            );
        }

        $attributes = Arr::only($changes, ['name', 'phone', 'email', 'is_active']);

        if ($attributes !== []) {
            $user->fill($attributes)->save();
        }

        if (array_key_exists('role', $changes)) {
            // Exactly one role per person. Overlapping roles make the RBAC
            // matrix unreadable and produce access nobody intended.
            $user->syncRoles([(string) $changes['role']]);
        }

        $this->audit->record(
            $isBeingDeactivated ? 'staff.deactivated' : 'staff.updated',
            subjectType: 'User',
            subjectId: $user->id,
            metadata: ['fields' => array_keys($changes)],
        );

        return new StaffResource($user->refresh()->load('roles'));
    }

    /**
     * Whether this user is the only active administrator left.
     *
     * The clinic's active staff are loaded and checked in PHP rather than
     * filtered by a role join. The set is bounded by the size of one clinic's
     * payroll -- tens of people, not thousands -- and the readable version of
     * this check is the one that stays correct when the role storage changes.
     */
    private function isLastActiveAdministrator(User $user, string $tenantId): bool
    {
        if (! $user->is_active || ! $user->hasRole(ClinicalRole::ClinicAdmin->value)) {
            return false;
        }

        $others = User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->whereKeyNot($user->getKey())
            ->with('roles')
            ->get();

        foreach ($others as $other) {
            if ($other->hasRole(ClinicalRole::ClinicAdmin->value)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Where an invited colleague goes to set up their account.
     *
     * On Carevelo's own host, not the clinic's subdomain. Two reasons, and both
     * matter: the clinic console is a Carevelo-branded surface by design -- only
     * the PATIENT-facing surface belongs to the clinic -- and interpolating a
     * tenant-chosen string into a message body is the same class of mistake as
     * letting one reach a stylesheet.
     */
    private function setupLink(string $token): string
    {
        return rtrim((string) config('app.url'), '/').'/invitations/'.$token;
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
