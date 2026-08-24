<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Http\Controllers\Controller;
use App\Http\Requests\Platform\ConfirmTotpEnrolmentRequest;
use App\Http\Responses\ProblemDetails;
use App\Models\User;
use App\Support\Totp\RecoveryCodes;
use App\Support\Totp\Totp;
use App\Support\Totp\TotpAuthenticator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Enrolling and re-enrolling an authenticator app.
 *
 * ============================================================
 * THIS IS ROTATION, NOT FIRST ENROLMENT
 * ============================================================
 *
 * Both routes are inside the platform group, behind `auth:sanctum` AND
 * RequireSecondFactor, which means the operator using them has ALREADY passed a
 * second factor for this account in this session. That is not an oversight in
 * the flow -- it is what makes these endpoints safe to expose at all.
 *
 * An enrolment endpoint reachable with a password alone would be a password-only
 * path to a second factor: post a password, enrol your own authenticator, pass
 * the challenge you just created. That is the exact hole this whole surface
 * exists to close, and it would close nothing while looking like it did.
 *
 * FIRST enrolment therefore happens off the HTTP surface entirely, through
 * `php artisan platform:enrol`, whose only caller is somebody with shell access
 * to the application -- a stronger check than any endpoint could apply, and
 * exactly what docs/40-api/authentication-and-sessions.md § Second factor means
 * by recovery "out of band, as a recorded administrative action". The same
 * command is how an operator who has lost their authenticator gets back in.
 *
 * ============================================================
 * WHAT THESE TWO RESPONSES CONTAIN, AND HOW OFTEN
 * ============================================================
 *
 * `store` returns a live TOTP secret. `confirm` returns ten live recovery codes.
 * Each is the only moment that value exists outside the operator's own
 * authenticator or their own notes: nothing is written in the clear, nothing is
 * logged, no audit event carries any of it, and there is no second endpoint that
 * shows them again. An operator who closed the tab enrols again.
 *
 * That is the same write-only discipline the aggregator credentials are held to
 * (docs/50-security-compliance/rbac-matrix.md: "write-only and unreadable by
 * anyone -- phishing the UI yields nothing to read"), and it is why there is no
 * `GET` on either route. An endpoint that could show a secret back is an
 * endpoint worth phishing, worth screenshotting, and worth a support tool
 * calling "just to check".
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */
class TotpEnrolmentController extends Controller
{
    public function __construct(protected TotpAuthenticator $totp) {}

    /**
     * Generate a secret and hand back the enrolment URI, once.
     *
     * THIS REVOKES WHAT THE ACCOUNT HAD, immediately and before anything is
     * proved: the previous secret is overwritten, the account is marked
     * unconfirmed, and every recovery code is destroyed. An operator who starts
     * this and abandons it cannot sign in until they finish it, and that is the
     * correct trade rather than an accident. Re-enrolment is what somebody does
     * when they believe their authenticator is compromised, and a rotation that
     * left the old secret working until the new one was confirmed would keep the
     * compromised factor live for exactly as long as the operator hesitated.
     *
     * 201, because a new credential now exists.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $this->platformOperator($request);

        if (! $user instanceof User) {
            return $this->notAPlatformAccount();
        }

        $enrolment = $this->totp->beginEnrolment($user, Totp::ISSUER);

        return new JsonResponse([
            'data' => [
                /*
                 * BOTH FORMS OF THE SAME SECRET, and both are needed.
                 *
                 * `uri` is what a camera scans. `secret` is what an operator
                 * types when the camera will not focus -- which, on a desk in a
                 * badly-lit room with a laptop screen, is often. Omitting the
                 * typed form does not reduce the exposure: the URI contains the
                 * secret in full, in the query string, in plain view.
                 */
                'secret' => $enrolment->secret,
                'uri' => $enrolment->uri,

                // Stated in the payload as well as in this docblock, because
                // the client renders it and the operator is the person who has
                // to act on it.
                'shown_once' => true,
            ],
        ], 201);
    }

    /**
     * Prove the authenticator works, activate it, and issue the recovery codes.
     *
     * The code is checked with the SAME window and the SAME replay defence a
     * sign-in challenge uses, because an enrolment confirmed by a code the
     * challenge path would refuse is an enrolment that appears to succeed and
     * then cannot be used.
     */
    public function confirm(ConfirmTotpEnrolmentRequest $request): JsonResponse
    {
        $user = $this->platformOperator($request);

        if (! $user instanceof User) {
            return $this->notAPlatformAccount();
        }

        $codes = $this->totp->confirmEnrolment($user, $request->code());

        if ($codes === null) {
            /*
             * ONE SENTENCE, and it does not distinguish a wrong code from a
             * replayed one or from "there is no pending enrolment on this
             * account". The audit trail holds the distinction -- see
             * TotpAuthenticator::recordChallenge -- and the operator in front
             * of the screen can act on all three the same way: look at the app
             * again, or start the enrolment again.
             *
             * A 422 rather than a 403: the request is well-formed and the
             * caller is authorised, and what is wrong is the value of a field.
             */
            return ProblemDetails::make(
                422,
                'totp_confirmation_failed',
                'That code did not match',
                'Enter the six digits your authenticator is showing now. If the enrolment '
                .'was started some time ago, start it again.',
            );
        }

        return new JsonResponse([
            'data' => [
                /*
                 * THE ONLY TIME THESE EXIST IN THE CLEAR. Ten codes, each
                 * spendable once, each stored as a SHA-256 digest the moment it
                 * was minted. There is no "show my codes" endpoint and there
                 * must not be one: an operator who did not write them down
                 * enrols again, which costs them two minutes, where a second
                 * endpoint costs everybody a standing way to read ten bypasses
                 * of the second factor out of a live system.
                 */
                'recovery_codes' => $codes,
                'shown_once' => true,

                // The count is worth returning so a client can say "ten codes,
                // each usable once" rather than counting an array and hoping.
                'count' => RecoveryCodes::COUNT,
            ],
        ]);
    }

    /**
     * The authenticated account, if it is a platform one.
     *
     * A `clinic_admin` legitimately reaches this GROUP -- the break-glass
     * register is theirs to read, because their clinic is the data controller --
     * and must not reach THESE two routes. The specification RECOMMENDS a second
     * factor for `clinic_admin` and does not require one, and crucially the
     * tenant sign-in has no challenge step: an enrolment made here would be a
     * secret that nothing ever asks for, on an account that would now be marked
     * enrolled. If a later change ever does make RequireSecondFactor bite on
     * tenant accounts, that clinic administrator is locked out of their own
     * clinic by a credential they set up on the wrong surface.
     *
     * When the tenant-side second factor is built, it gets its own enrolment
     * endpoint on the tenant surface in the same change as the challenge step.
     */
    private function platformOperator(Request $request): ?User
    {
        $user = $request->user();

        return $user instanceof User && $user->isPlatformUser() ? $user : null;
    }

    private function notAPlatformAccount(): JsonResponse
    {
        return ProblemDetails::make(
            403,
            'not_a_platform_account',
            'This is not a platform account',
            'Enrolling an authenticator here is for Carevelo platform operators. A clinic '
            .'account enrols through its own clinic, and that surface is not built yet.',
        );
    }
}
