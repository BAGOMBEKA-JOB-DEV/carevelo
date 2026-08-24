<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Platform\PlatformSignInRequest;
use App\Http\Requests\Platform\SecondFactorChallengeRequest;
use App\Http\Resources\V1\MeResource;
use App\Http\Responses\ProblemDetails;
use App\Models\User;
use App\Support\Auth\AuthProblem;
use App\Support\Auth\CredentialVerifier;
use App\Support\Auth\PlatformAccounts;
use App\Support\Auth\PlatformAuthThrottle;
use App\Support\Auth\SessionRegistry;
use App\Support\Totp\ChallengeOutcome;
use App\Support\Totp\SecondFactorSession;
use App\Support\Totp\TotpAuthenticator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/**
 * How a Carevelo platform operator signs in, in two steps, and how they leave.
 *
 * ============================================================
 * WHY THIS EXISTS SEPARATELY FROM AuthController
 * ============================================================
 *
 * `POST /v1/auth/sign-in` sits inside the `v1` group behind ResolveTenant. That
 * middleware reads a tenant from the request HOST, 404s when the host resolves
 * to no clinic, and the controller behind it compares the password "against the
 * account at the resolved tenant" (App\Support\Auth\Accounts scopes every lookup
 * to `TenantContext::currentOrFail()`).
 *
 * A platform account has NO TENANT. `tenant_id is null` is the definition of one
 * -- it is what App\Models\User::isPlatformUser() reads -- so there is nothing
 * for that endpoint to scope the lookup to and no host it could be reached on. A
 * platform operator therefore could not sign in AT ALL, on any host, which is
 * exactly what the platform-admin app said on screen for as long as this
 * controller did not exist.
 *
 * Signing in on some clinic's subdomain to obtain a cross-tenant session is not
 * the workaround it looks like: docs/40-api/authentication-and-sessions.md
 * § Tenant binding defines a session whose tenant does not match the host as a
 * hard 403 and an audit event, because it means a bug or an attack. So this
 * route lives in the platform group, which runs
 * `->withoutMiddleware([ResolveTenant::class, BindTenantContext::class])`, and a
 * platform sign-in resolves no tenant and binds none. The audit events it writes
 * carry a null tenant_id and live in the platform trail, which is correct: this
 * act belongs to no clinic.
 *
 * ============================================================
 * TWO STEPS, AND THE PASSWORD STEP ISSUES NO SESSION
 * ============================================================
 *
 * docs/40-api/authentication-and-sessions.md, acceptance criterion 5: "Platform
 * operators cannot authenticate without a second factor." Not "are prompted
 * for" -- cannot.
 *
 * The obvious way to build that is to authenticate on the password, mark the
 * session "second factor outstanding", and refuse everything with middleware
 * until it is discharged. It is how RequirePasswordChange works and it is the
 * WRONG shape here, for a reason worth reading in full in
 * App\Support\Totp\SecondFactorSession: a half-authenticated platform session is
 * a real Sanctum session for an account with a null tenant_id, and `auth:sanctum`
 * is not confined to these routes -- the same cookie reaches every /v1 route on
 * every clinic host, where ResolveTenant's session/host check passes trivially
 * because there is no session tenant to mismatch. Middleware on the platform
 * group would not be anywhere near it.
 *
 * So `signIn()` calls no guard. It proves the password, writes a PENDING
 * CHALLENGE into the session, and returns "now show me a code". Until a code
 * verifies there is no authenticated session anywhere in the system, and the
 * acceptance criterion is true by construction rather than by a list of routes
 * somebody has to keep correct. RequireSecondFactor still guards the whole
 * platform group as the second lock on the same door -- see that class for why
 * that is not redundancy.
 *
 * A COMBINED FORM WOULD ALSO BE WORSE FOR THE OPERATOR, and this is the reason
 * the frontend has two screens: one form taking a password and a code together
 * has to say which half was wrong, and "your password is right, your code is
 * not" is a valuable sentence to somebody working a credential-stuffing list.
 *
 * ============================================================
 * WHAT NEVER APPEARS IN A RESPONSE OR AN AUDIT EVENT HERE
 * ============================================================
 *
 * The TOTP secret, the `otpauth://` URI that contains it, the code that was
 * typed, and any recovery code. The audit events record which account, what
 * happened, and nothing that could be used to make it happen again.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/threat-model.md § Spoofing
 */
class PlatformAuthController extends Controller
{
    /**
     * The single failure message for the password step.
     *
     * "No such platform account" and "wrong password" are the same sentence,
     * for the same reason the tenant sign-in makes them the same sentence: the
     * response, the status and the timing must not tell a caller which of the
     * two happened. CredentialVerifier does the timing half by comparing
     * against a decoy digest when there is no account.
     *
     * It says "Carevelo" rather than "this clinic" because that is what this
     * surface is, and because an operator typing their clinic-side address into
     * the platform console is a support call worth answering honestly.
     */
    private const REJECTED = 'Those details do not match a Carevelo platform account.';

    /**
     * The single failure message for the code step.
     *
     * ONE SENTENCE FOR FOUR OUTCOMES: a wrong code, a code from outside the
     * ninety-second window, a code that has already been spent, and a recovery
     * code that does not match. Telling a replay apart from a wrong code on
     * screen would tell an attacker they hold a REAL code in the wrong window,
     * which is the single most useful thing they could learn at that point. The
     * distinction is not lost -- it is in the audit trail, where a reviewer
     * needs it and an attacker cannot see it.
     */
    private const CODE_REJECTED = 'That code is not right. Try the current one from your authenticator.';

    public function __construct(
        protected PlatformAccounts $accounts,
        protected PlatformAuthThrottle $throttle,
        protected CredentialVerifier $credentials,
        protected SessionRegistry $sessions,
        protected SecondFactorSession $secondFactor,
        protected TotpAuthenticator $totp,
        protected AuditLog $audit,
    ) {}

    /**
     * Step one: prove the password. Returns no session.
     *
     * A 200 from here means "the password was right and a code is now
     * required", and it is the only thing an operator can learn from it. Note
     * what it does NOT return: nothing about the account, no name, no roles, no
     * identifier. RequireSecondFactor::PERMITTED_ROUTES makes the same argument
     * about `/v1/me` -- handing an account's details to whoever holds the
     * password alone is a disclosure, and the client needs exactly one fact to
     * render the next screen: that there is a next screen.
     */
    public function signIn(PlatformSignInRequest $request): JsonResponse
    {
        $email = $request->email();

        // Counted BEFORE the lookup, so being over the limit is
        // indistinguishable between a registered and an unregistered address.
        $retryAfter = $this->throttle->signIn($email, $request->ip());

        if ($retryAfter !== null) {
            return AuthProblem::throttled($retryAfter);
        }

        $user = $this->accounts->activeFor($email);

        // Called with a null user on purpose, and BEFORE the null is tested. The
        // comparison happens either way -- against a decoy digest when there is
        // no account -- so both branches cost the same. Short-circuiting on the
        // null would put the timing leak straight back.
        $authenticated = $this->credentials->matches($user, $request->password());

        if ($user === null || ! $authenticated) {
            // `account_exists` is for the reviewer, who needs to tell an
            // operator who forgot their password from somebody walking a list
            // of addresses. It is never in the response. The address itself is
            // not recorded: AuditLog::scrub() drops an `email` key, and that is
            // the right default on a trail retained permanently.
            $this->audit->record('auth.sign_in_failed', metadata: [
                'method' => 'platform_password',
                'account_exists' => $user !== null,
            ]);

            throw ValidationException::withMessages(['email' => self::REJECTED]);
        }

        if (! $this->totp->isEnrolled($user)) {
            /*
             * A CORRECT PASSWORD ON AN UNENROLLED PLATFORM ACCOUNT IS A DEAD END,
             * and deliberately so.
             *
             * The tempting alternative is to sign them in and make them enrol
             * -- it is what most products do, and it is a password-only path to
             * a session on the account that can authorise a break-glass grant
             * into a clinic's patient records. Acceptance criterion 5 does not
             * have an exception for "not enrolled yet"; an operator who cannot
             * complete a second factor cannot authenticate, full stop.
             *
             * So enrolment happens elsewhere: `php artisan platform:enrol` for
             * the first operator and for one who has lost their authenticator,
             * which the specification already describes as recovery "out of
             * band, as a recorded administrative action" -- performed by
             * somebody with shell access, which is a stronger check than
             * anything this endpoint could apply.
             *
             * It is a 403 and not a 422 because nothing about the request was
             * wrong. It is stated plainly rather than hidden behind the generic
             * refusal because the caller has already proved who they are, and a
             * neutral "those details do not match" here would send an operator
             * to reset a password that works perfectly.
             */
            $this->audit->record(
                'auth.sign_in_refused',
                subjectType: 'User',
                subjectId: (string) $user->getKey(),
                metadata: ['reason' => 'second_factor_not_enrolled'],
                actor: $user,
            );

            return ProblemDetails::make(
                403,
                'second_factor_not_enrolled',
                'This account has no second factor',
                'A platform operator signs in with a password and then a code from an '
                .'authenticator app. This account has no authenticator enrolled, and one '
                .'is set up out of band by an administrator rather than from this screen.',
            );
        }

        // Regenerates the session id first, then stores the pending challenge.
        // See SecondFactorSession: an attacker who planted a session id on a
        // shared machine must not be holding the session a password was just
        // proved into.
        $this->secondFactor->beginChallenge($request, $user);

        $this->audit->record(
            'totp.challenge_issued',
            subjectType: 'User',
            subjectId: (string) $user->getKey(),
            metadata: ['method' => 'platform_password'],
            actor: $user,
        );

        return new JsonResponse([
            'data' => [
                // Named rather than boolean, so the client renders the right
                // second step. There is exactly one value it can take today and
                // there must never be an `sms` one -- see Totp::uri().
                'second_factor' => 'totp',
                'expires_in' => SecondFactorSession::PENDING_TTL_SECONDS,
            ],
        ]);
    }

    /**
     * Step two: the code. This is the request that actually signs anybody in.
     */
    public function challenge(SecondFactorChallengeRequest $request): MeResource|JsonResponse
    {
        $pendingUserId = $this->secondFactor->pendingUserId($request);

        if ($pendingUserId === null) {
            return $this->challengeExpired();
        }

        // Keyed on the ACCOUNT rather than on the address, because at this point
        // the account is known and the address is not in the request. The budget
        // is the smallest in the system: a six-digit code is one in a million,
        // and the limit is what makes that number mean something against an
        // attacker who already holds the password. See PlatformAuthThrottle.
        $retryAfter = $this->throttle->challenge($pendingUserId, $request->ip());

        if ($retryAfter !== null) {
            return AuthProblem::throttled($retryAfter);
        }

        // Re-checked, not trusted. The session carries an id proved up to five
        // minutes ago, and deactivation or the removal of a platform role in
        // that window is exactly what somebody does when they have just realised
        // a credential is compromised. See PlatformAccounts::activeById().
        $user = $this->accounts->activeById($pendingUserId);

        if ($user === null) {
            $this->secondFactor->clearChallenge($request);

            return $this->challengeExpired();
        }

        $outcome = $request->isRecovery()
            ? $this->totp->spendRecoveryCode($user, $request->credential())
            : $this->totp->verify($user, $request->credential());

        if (! $outcome->isAccepted()) {
            // No audit event here: TotpAuthenticator has already written one,
            // with the outcome that distinguishes a replay from a wrong code.
            // Recording a second from this side would double every failure in
            // the trail and invite the two to disagree.
            //
            // The PENDING CHALLENGE SURVIVES a wrong code, on purpose. An
            // operator mistypes six digits routinely, and dropping them back to
            // the password form for it would teach them to keep a password
            // manager open on the platform console. What bounds the guessing is
            // the limiter above, which is the control; the five-minute lifetime
            // of the pending challenge bounds the rest.
            throw ValidationException::withMessages([
                $request->isRecovery() ? 'recovery_code' : 'code' => self::CODE_REJECTED,
            ]);
        }

        // Spent. Nothing left to discharge, and leaving it would be a proven
        // password sitting in the session store of a machine that now has a
        // session anyway.
        $this->secondFactor->clearChallenge($request);

        // THE ONLY PLACE A PLATFORM SESSION IS OPENED. Logs the user in on the
        // `web` guard and regenerates the session id, so the identifier the
        // operator carries away is not one that existed before they were
        // authenticated.
        $this->sessions->start($request, $user);

        // AFTER start(), so the stamp lands on the regenerated session id rather
        // than on the one just discarded. RequireSecondFactor reads this and
        // nothing else writes it.
        $this->secondFactor->markVerified($request, $user);

        // A completed challenge is proof that no guessing happened, so the
        // budget goes back. Without this an operator who fumbles a code twice
        // carries two of their ten guesses into next week.
        $this->throttle->clearChallenge((string) $user->getKey(), $request->ip());

        $this->audit->record(
            'auth.signed_in',
            subjectType: 'User',
            subjectId: (string) $user->getKey(),
            // WHICH FACTOR, because a session opened with a recovery code is a
            // different fact from one opened with a live authenticator, and a
            // reviewer reading the platform trail should not have to join two
            // events to see it. The code itself is not here, in either form.
            metadata: [
                'method' => $outcome === ChallengeOutcome::AcceptedByRecoveryCode
                    ? 'platform_password_and_recovery_code'
                    : 'platform_password_and_totp',
                'surface' => 'platform',
            ],
            actor: $user,
        );

        // The same resource /v1/platform/me returns. A client that has just
        // signed in wants exactly what it would ask that endpoint for.
        return new MeResource($user);
    }

    /**
     * Who am I.
     *
     * A platform counterpart to `GET /v1/me`, which a platform operator cannot
     * reach: that route is inside the `v1` group behind ResolveTenant, and
     * `admin.carevelo.app` resolves to no clinic, so it answers 404 before the
     * controller runs.
     *
     * Behind RequireSecondFactor with everything else in the group. There is
     * deliberately no exemption for it -- see RequireSecondFactor's
     * PERMITTED_ROUTES for why handing an account's name, address and platform
     * roles to a session that has passed only a password is a disclosure rather
     * than a convenience.
     */
    public function me(Request $request): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        return new MeResource($user);
    }

    /**
     * Leave.
     *
     * Reachable by a session that has NOT completed a second factor -- it is the
     * one route on RequireSecondFactor::PERMITTED_ROUTES -- because a person who
     * cannot proceed must still be able to close what they opened. On a shared
     * machine the alternative is walking away from a half-open session.
     */
    public function signOut(Request $request): Response
    {
        // Recorded BEFORE the session ends, so the event carries the operator
        // who ended it rather than an anonymous actor.
        $this->audit->record(
            'auth.signed_out',
            subjectType: 'User',
            subjectId: $request->user()?->getAuthIdentifier(),
            metadata: ['surface' => 'platform'],
        );

        // The verification stamp goes with the session. A stamp that outlived
        // the sign-out would sit in the store waiting for the next account to
        // authenticate into the same session and inherit a factor it never
        // passed -- which is why the stamp is bound to a user id as well.
        $this->secondFactor->forget($request);

        $this->sessions->end($request);

        return response()->noContent();
    }

    /**
     * No live pending challenge, or the account behind it is no longer one.
     *
     * ONE RESPONSE FOR BOTH, and a 401 rather than a 403. There is no session
     * here, so 401 is the accurate status and it sends the client back to the
     * password form, which is where the operator has to start again either way.
     * Answering differently for "expired" and "that account has been
     * deactivated" would confirm the deactivation to whoever now holds the
     * password.
     */
    private function challengeExpired(): JsonResponse
    {
        return ProblemDetails::make(
            401,
            'challenge_expired',
            'That sign-in has expired',
            'A code is expected within '.(SecondFactorSession::PENDING_TTL_SECONDS / 60)
            .' minutes of the password. Enter your email address and password again.',
        );
    }
}
