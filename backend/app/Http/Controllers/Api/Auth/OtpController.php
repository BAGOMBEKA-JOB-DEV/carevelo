<?php

namespace App\Http\Controllers\Api\Auth;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RequestOtpRequest;
use App\Http\Requests\Auth\VerifyOtpRequest;
use App\Support\Auth\Accounts;
use App\Support\Auth\AuthProblem;
use App\Support\Auth\AuthThrottle;
use App\Support\Auth\CredentialVerifier;
use App\Support\Auth\OneTimeCodes;
use App\Support\Auth\OtpOutcome;
use App\Support\Auth\OtpPurpose;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\ValidationException;

/**
 * Sign-in by one-time code.
 *
 * This is the whole of authentication for a patient. Requiring a password from
 * someone who consults twice a year produces forgotten passwords, and a
 * forgotten password here is a patient who never reads their prescription.
 *
 * Both endpoints are ENUMERATION-SAFE. The response to "that number is not
 * registered here" is byte-for-byte the response to "a code is on its way",
 * because confirming that a number is registered at a specific clinic discloses
 * that the person is a patient of it -- special-category data under DPPA 2019,
 * handed to anybody who can type a phone number into a form.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class OtpController extends Controller
{
    /**
     * The only answer either branch of `request` gives.
     *
     * Phrased so it is honest in both cases. "We have sent you a code" would be
     * a lie half the time, and lying to users about security mechanics is how
     * they learn to ignore them.
     */
    private const NEUTRAL = 'If that number is registered, a code has been sent by SMS.';

    /**
     * The only answer every refusal of `verify` gives.
     *
     * Wrong code, expired code, already-spent code, unregistered number: one
     * message, one status. The differences live in the audit trail, where the
     * clinic can act on them and an attacker cannot see them.
     */
    private const REJECTED = 'That code is not valid. Request a new one.';

    public function __construct(
        protected OneTimeCodes $codes,
        protected Accounts $accounts,
        protected AuthThrottle $throttle,
        protected CredentialVerifier $credentials,
        protected SessionRegistry $sessions,
        protected AuditLog $audit,
    ) {}

    /**
     * Send a code, if there is anybody to send it to.
     *
     * 202 either way: the clinic accepted the request, and what happened next is
     * deliberately not reported.
     */
    public function request(RequestOtpRequest $request): JsonResponse
    {
        $phone = $request->phone();

        $retryAfter = $this->throttle->otpRequest($phone, $request->ip());

        if ($retryAfter !== null) {
            return AuthProblem::throttled($retryAfter);
        }

        $user = $this->accounts->activeFor($phone);

        if ($user === null) {
            // Nothing observable happens. One bcrypt comparison stands in for
            // the hash the issuing branch performs, so the two take comparable
            // time -- an unregistered number answering in a millisecond while a
            // registered one takes a hundred leaks by stopwatch exactly what the
            // response body refuses to say.
            $this->credentials->decoy($phone);

            $this->audit->record('otp.requested', metadata: [
                'outcome' => OtpOutcome::UnknownIdentity->value,
            ]);
        } else {
            $code = $this->codes->issue($phone, OtpPurpose::SignIn, $request->ip());

            $this->audit->record('otp.requested',
                subjectType: 'User',
                subjectId: $user->id,
                metadata: [
                    // The identifier of the code, never the code. An audit event
                    // records THAT something happened to WHICH record.
                    'otp_code_id' => $code->id,
                    'outcome' => 'issued',
                ],
            );
        }

        return response()->json(['message' => self::NEUTRAL], 202);
    }

    /**
     * Spend a code and open a session bound to this clinic.
     */
    public function verify(VerifyOtpRequest $request): JsonResponse
    {
        $phone = $request->phone();

        $retryAfter = $this->throttle->otpVerify($phone, $request->ip());

        if ($retryAfter !== null) {
            return AuthProblem::throttled($retryAfter);
        }

        // Verified before the account is looked up, and unconditionally, so a
        // number with no codes costs the same as one that has just been sent a
        // code.
        $verification = $this->codes->verify($phone, $request->code(), OtpPurpose::SignIn);
        $user = $this->accounts->activeFor($phone);

        if (! $verification->succeeded() || $user === null) {
            $this->audit->record('otp.verification_failed',
                subjectType: 'OtpCode',
                subjectId: $verification->code?->id,
                metadata: [
                    'reason' => $user === null
                        ? OtpOutcome::UnknownIdentity->value
                        : $verification->outcome->value,
                ],
            );

            throw ValidationException::withMessages(['code' => self::REJECTED]);
        }

        if (! $this->accounts->mayStartSession($user)) {
            return AuthProblem::suspended();
        }

        $this->audit->record('otp.verified',
            subjectType: 'OtpCode',
            subjectId: $verification->code?->id,
            metadata: ['user_id' => $user->id],
            actor: $user,
        );

        // The code proved control of the handset, which is the whole reason the
        // number was recorded. Noting it lets the clinic tell a verified contact
        // number from one typed at a front desk.
        if ($user->getAttribute('phone_verified_at') === null) {
            $user->setAttribute('phone_verified_at', Date::now());
            $user->save();
        }

        $this->sessions->start($request, $user);

        $this->audit->record('auth.signed_in',
            subjectType: 'User',
            subjectId: $user->id,
            metadata: ['method' => 'otp'],
            actor: $user,
        );

        return response()->json($user);
    }
}
