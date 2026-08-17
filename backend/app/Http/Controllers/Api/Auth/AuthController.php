<?php

namespace App\Http\Controllers\Api\Auth;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\SignInRequest;
use App\Http\Requests\Auth\UpdatePasswordRequest;
use App\Models\User;
use App\Support\Auth\Accounts;
use App\Support\Auth\AuthProblem;
use App\Support\Auth\AuthThrottle;
use App\Support\Auth\CredentialVerifier;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/**
 * Password sign-in, sign-out, and password change.
 *
 * The branch that matters in `signIn` is the one where the number is unknown: it
 * must be indistinguishable from a wrong password, in body, in status and in
 * timing. Confirming that a number is registered at a specific clinic discloses
 * that the person is a patient there, which is itself health-adjacent
 * information -- and the clinics using Carevelo are frequently each other's
 * local competitors.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class AuthController extends Controller
{
    /**
     * The single failure message.
     *
     * "No account for that number" and "wrong password" are the same sentence
     * here. It is less helpful than a specific message, and that is the trade
     * being made deliberately.
     */
    private const REJECTED = 'Those details do not match an account at this clinic.';

    public function __construct(
        protected Accounts $accounts,
        protected AuthThrottle $throttle,
        protected CredentialVerifier $credentials,
        protected SessionRegistry $sessions,
        protected AuditLog $audit,
    ) {}

    /**
     * Sign in with an email address or a phone number, and a password.
     */
    public function signIn(SignInRequest $request): JsonResponse
    {
        $field = $request->identifierField();
        $identifier = $request->identifier();

        $retryAfter = $this->throttle->passwordSignIn($identifier, $request->ip());

        if ($retryAfter !== null) {
            return AuthProblem::throttled($retryAfter);
        }

        // Either identifier, one code path. Both lookups are tenant-scoped and both
        // return null for a deactivated account, so the branches below stay identical.
        $user = $field === 'email'
            ? $this->accounts->activeForEmail($identifier)
            : $this->accounts->activeFor($identifier);

        // Called with a null user on purpose, and BEFORE the null is tested. The
        // comparison happens either way -- against a decoy digest when there is
        // no account -- so the two branches cost the same and return the same.
        // Short-circuiting on the null would put the timing leak straight back.
        $authenticated = $this->credentials->matches($user, $request->password());

        if ($user === null || ! $authenticated) {
            $this->audit->record('auth.sign_in_failed', metadata: [
                'method' => 'password',
                // Whether an account exists is recorded for the CLINIC, which
                // needs to tell a member of staff who forgot their password from
                // somebody walking a list of numbers. It is never in the
                // response.
                'account_exists' => $user !== null,
            ]);

            // Attached to whichever field was sent, so the message appears under the
            // input the person actually filled in. The SENTENCE is the same either way:
            // "no account" and "wrong password" must stay indistinguishable.
            throw ValidationException::withMessages([$field => self::REJECTED]);
        }

        if (! $this->accounts->mayStartSession($user)) {
            return AuthProblem::suspended();
        }

        $this->sessions->start($request, $user);

        $this->audit->record('auth.signed_in',
            subjectType: 'User',
            subjectId: $user->id,
            metadata: ['method' => 'password'],
            actor: $user,
        );

        return response()->json($user);
    }

    public function signOut(Request $request): Response
    {
        // Recorded before the session ends, so the event carries the actor who
        // ended it rather than an anonymous one.
        $this->audit->record('auth.signed_out',
            subjectType: 'User',
            subjectId: $request->user()?->getAuthIdentifier(),
        );

        $this->sessions->end($request);

        return response()->noContent();
    }

    /**
     * Change your own password, ending every other session.
     *
     * The person doing this is often doing it BECAUSE they believe someone else
     * is signed in as them -- a clinic terminal left logged in at a front desk,
     * a handset that changed hands. A password change that leaves those sessions
     * alive does nothing about the thing that prompted it.
     */
    public function updatePassword(UpdatePasswordRequest $request): Response
    {
        /** @var User $user */
        $user = $request->user();

        if (! $this->credentials->matches($user, $request->currentPassword())) {
            throw ValidationException::withMessages([
                'current_password' => 'That is not your current password.',
            ]);
        }

        $user->password = $request->newPassword();

        // Rotated in the same write: this is what invalidates any remember-me
        // cookie held by a device we cannot reach through the session table.
        $this->sessions->rotateRememberToken($user);
        $user->save();

        $revoked = $this->sessions->purgeOtherSessions(
            $user,
            $request->hasSession() ? $request->session()->getId() : null,
        );

        $this->audit->record('password.changed',
            subjectType: 'User',
            subjectId: $user->id,
            metadata: ['sessions_revoked' => $revoked],
            actor: $user,
        );

        return response()->noContent();
    }
}
