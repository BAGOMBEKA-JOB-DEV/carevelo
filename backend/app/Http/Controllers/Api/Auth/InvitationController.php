<?php

namespace App\Http\Controllers\Api\Auth;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\AcceptInvitationRequest;
use App\Http\Responses\ProblemDetails;
use App\Models\StaffInvitation;
use App\Models\User;
use App\Support\Auth\Accounts;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;

/**
 * Accepting a staff invitation.
 *
 * Public, because the invitee has no account yet. The SMS-delivered token is the
 * credential: it went to the invited handset, so holding it is the proof that
 * the person controls that number.
 *
 * THE ROLE COMES OFF THE INVITATION ROW. Nothing in the request body can change
 * it. That is the whole reason this endpoint is separate from a general
 * registration endpoint -- a self-service role field on a public route is a
 * one-request path from "front desk" to "clinic administrator", the role that
 * can rewrite the clinic's aggregator credentials.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class InvitationController extends Controller
{
    public function __construct(
        protected Accounts $accounts,
        protected SessionRegistry $sessions,
        protected AuditLog $audit,
    ) {}

    public function accept(AcceptInvitationRequest $request, string $token): JsonResponse
    {
        $invitation = StaffInvitation::findByToken($token);

        if ($invitation === null) {
            // Neutral 404, and it is the same 404 for a token belonging to
            // another clinic -- row-level security means that row is simply not
            // there on this host. Anything else would confirm that a token
            // exists somewhere, which is a confirmation that a given person was
            // invited to some clinic.
            abort(404);
        }

        if ($invitation->isAccepted()) {
            // Distinguished from expiry, and safe to distinguish: the caller
            // already holds the token, so this discloses nothing they did not
            // give us. It is also the difference between "ask for a new link"
            // and "you already have an account".
            return ProblemDetails::make(
                409,
                'invitation_already_accepted',
                'This invitation has already been used',
                'Sign in with your phone number, or ask the clinic for a new invitation.',
            );
        }

        if ($invitation->isExpired()) {
            return ProblemDetails::make(
                410,
                'invitation_expired',
                'This invitation has expired',
                'Ask the clinic to send you a new one.',
            );
        }

        $phone = $invitation->phone->e164;

        if ($this->accounts->activeFor($phone) !== null) {
            return ProblemDetails::make(
                409,
                'account_exists',
                'That number already has an account at this clinic',
                'Sign in instead.',
            );
        }

        // Defence in depth behind StaffInvitation::issue(), which refuses to
        // create one of these. A platform role reaches across tenants, and no
        // tenant may hand one out -- least of all through a link sent by SMS.
        StaffInvitation::assertGrantable($invitation->role());

        $user = DB::transaction(function () use ($invitation, $request, $phone): User {
            $user = User::create([
                'tenant_id' => $invitation->tenant_id,
                'name' => $invitation->name,
                'phone' => $phone,
                'email' => $request->email() ?? StaffInvitation::placeholderEmail(),
                'password' => $request->password(),
                'is_active' => true,
            ]);

            // The token arrived by SMS at this number, so the number is proven.
            $user->forceFill(['phone_verified_at' => Date::now()])->save();

            $user->assignRole($invitation->role()->value);

            $invitation->markAcceptedBy($user);

            return $user;
        });

        $this->audit->record('invitation.accepted',
            subjectType: 'StaffInvitation',
            subjectId: $invitation->id,
            metadata: [
                'user_id' => $user->id,
                'role' => $invitation->role,
                'invited_by' => $invitation->invited_by,
            ],
            actor: $user,
        );

        $this->sessions->start($request, $user);

        $this->audit->record('auth.signed_in',
            subjectType: 'User',
            subjectId: $user->id,
            metadata: ['method' => 'invitation'],
            actor: $user,
        );

        return response()->json($user, 201);
    }
}
