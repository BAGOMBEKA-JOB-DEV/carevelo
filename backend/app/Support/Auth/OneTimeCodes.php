<?php

namespace App\Support\Auth;

use App\Models\OtpCode;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\TemplateRegistry;
use Illuminate\Support\Facades\Date;

/**
 * Issues and spends one-time codes.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class OneTimeCodes
{
    /**
     * How many stored codes a single verification compares against.
     *
     * More than one because a patient who taps "resend" twice on a slow network
     * then types the FIRST code to arrive is doing something entirely
     * reasonable, and refusing it teaches nothing except that the product is
     * broken. Bounded because every candidate costs a bcrypt comparison.
     */
    public const CANDIDATE_LIMIT = 3;

    /**
     * How long a spent code stays visible to the verifier.
     *
     * Well beyond its five-minute life, purely so a replay is still recognised
     * as a replay rather than falling off the end of the window and being
     * reported as a wrong guess. The distinction only exists in the audit trail
     * and this is what keeps it true.
     */
    public const REPLAY_WINDOW_MINUTES = 60;

    public function __construct(
        protected Notifier $notifier,
        protected CredentialVerifier $credentials,
    ) {}

    /**
     * Issue a code and send it.
     *
     * The plaintext never leaves this method: it goes to the Notifier, which
     * renders it into the one link-free template in the catalogue, and is
     * dropped. The caller gets the record, so it can be named by identifier in
     * an audit event.
     */
    public function issue(string $e164, OtpPurpose $purpose, ?string $ipAddress = null): OtpCode
    {
        [$record, $code] = OtpCode::issue($e164, $purpose, $ipAddress);

        $this->notifier->send(TemplateRegistry::REGISTRATION_OTP, $e164, [
            'code' => $code,
            'expires_in_minutes' => OtpCode::TTL_MINUTES,
        ]);

        return $record;
    }

    /**
     * Check a submitted code, spending it on success.
     *
     * Every path costs exactly CANDIDATE_LIMIT bcrypt comparisons, padded with
     * decoys where there are fewer stored codes than that. Otherwise a number
     * with no codes at all would answer measurably faster than one that has
     * just been sent a code, which is a way of asking whether somebody is a
     * patient of this clinic and getting an answer.
     */
    public function verify(string $e164, string $candidate, OtpPurpose $purpose): OtpVerification
    {
        $codes = OtpCode::query()
            ->where('phone', $e164)
            ->where('purpose', $purpose->value)
            ->where('created_at', '>=', Date::now()->subMinutes(self::REPLAY_WINDOW_MINUTES))
            ->orderByDesc('created_at')
            ->limit(self::CANDIDATE_LIMIT)
            ->get();

        $match = null;

        // No early exit: the loop runs to the end whether or not it has already
        // found the code, so the work does not depend on which code matched.
        foreach ($codes as $code) {
            if ($code->matches($candidate) && $match === null) {
                $match = $code;
            }
        }

        for ($i = $codes->count(); $i < self::CANDIDATE_LIMIT; $i++) {
            $this->credentials->decoy($candidate);
        }

        if ($match === null) {
            // Charge the guess against the newest usable code. Charging every
            // code would let one wrong guess burn a resend the patient is still
            // waiting for.
            $codes->first(fn (OtpCode $code): bool => $code->isLive())?->registerFailedAttempt();

            return new OtpVerification(OtpOutcome::Mismatch);
        }

        if ($match->isConsumed()) {
            return new OtpVerification(OtpOutcome::Replayed, $match);
        }

        if ($match->isExpired()) {
            return new OtpVerification(OtpOutcome::Expired, $match);
        }

        $match->consume();

        return new OtpVerification(OtpOutcome::Verified, $match);
    }
}
