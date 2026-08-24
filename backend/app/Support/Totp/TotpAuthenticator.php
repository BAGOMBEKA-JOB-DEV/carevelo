<?php

namespace App\Support\Totp;

use App\Audit\AuditLog;
use App\Models\User;
use Illuminate\Support\Facades\Date;
use RuntimeException;

/**
 * Enrolment, confirmation and challenge -- the whole of the second factor's state.
 *
 * ============================================================
 * REPLAY DEFENCE, WHICH IS THE PART WORTH READING
 * ============================================================
 *
 * RFC 6238 §5.2 is explicit: the verifier MUST NOT accept a second authentication
 * for the same time step. A TOTP code is valid for ninety seconds under the skew
 * window this system permits, which is ninety seconds in which a code shoulder-
 * surfed, read off a screen-share, or captured by a proxy in front of the
 * operator is as good as the operator's phone.
 *
 * `users.totp_last_used_step` is a MONOTONIC HIGH-WATER MARK, advanced by a
 * conditional UPDATE:
 *
 *     update users set totp_last_used_step = :step
 *      where id = :id and (totp_last_used_step is null or totp_last_used_step < :step)
 *
 * A step is accepted only when that statement reports one row affected. Two
 * requests carrying the same code therefore produce exactly one winner, decided
 * by PostgreSQL rather than by a read-then-write in PHP that a second request can
 * interleave with. It also refuses a code from an EARLIER step than the last one
 * accepted, which is stricter than the RFC requires and is right: within a
 * ninety-second window there are three live codes, and having spent the newest
 * there is no legitimate reason to go back to an older one.
 *
 * A COLUMN AND NOT THE CACHE. The obvious alternative is a cache key with a
 * ninety-second time-to-live, and it is weaker in a way that is easy to miss: the
 * cache store is `array` in tests, is flushed by a deploy or a restart in
 * production, and is a separate system that can be unavailable. A replay defence
 * that quietly stops defending when Redis restarts is not one. The column is in
 * the same transaction as everything else about the account.
 *
 * ============================================================
 * WHAT NEVER LEAVES THIS CLASS
 * ============================================================
 *
 * The secret. It is written through Laravel's `encrypted` cast, it is on User's
 * `$hidden` list, no API resource exposes it, and there is no method here that
 * returns a STORED secret -- only beginEnrolment(), which returns the one it just
 * generated, to the one response that shows it. Recovery codes are the same, via
 * RecoveryCodes.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */
final class TotpAuthenticator
{
    public function __construct(
        private readonly Totp $totp,
        private readonly RecoveryCodes $recoveryCodes,
        private readonly AuditLog $audit,
    ) {}

    /**
     * Whether this account can complete a second factor challenge at all.
     *
     * CONFIRMED, not merely present. A secret that was generated and never proved
     * against a real authenticator is a secret nobody has -- treating it as
     * enrolment would lock the operator out with a code they cannot produce.
     */
    public function isEnrolled(User $user): bool
    {
        return $user->totp_confirmed_at !== null && $this->secretOf($user) !== null;
    }

    /**
     * Generate a secret and hold it UNCONFIRMED.
     *
     * The account cannot authenticate with it yet, and -- this is the part that
     * matters -- it cannot authenticate with the PREVIOUS one either, because the
     * previous one has just been overwritten. That is deliberate: re-enrolment is
     * what an operator does when they believe their authenticator is compromised,
     * and a rotation that left the old secret working until the new one was
     * confirmed would leave the compromised factor live for exactly as long as the
     * operator hesitated.
     *
     * The recovery codes go with it, for the same reason. Codes minted against a
     * secret that has been rotated away must not survive the rotation.
     *
     * THE URI IS LABELLED WITH THE OPERATOR'S EMAIL ADDRESS, and an account with
     * no address cannot enrol here. That is not defensive tidiness: an email
     * address and a password is the whole of how a platform account signs in, so
     * an account without one cannot reach this code by any route the product
     * has, and the alternative to refusing -- falling back to the account's id
     * -- would put an unreadable ULID in front of an operator who has to pick
     * the right entry out of their authenticator during an incident. Totp::uri()
     * says at length why the label is an address and never a phone number.
     *
     * @throws RuntimeException when the account has no email address to label
     */
    public function beginEnrolment(User $user, string $issuer): Enrolment
    {
        $account = $user->email;

        if ($account === null || trim($account) === '') {
            throw new RuntimeException(
                'A second factor is enrolled against an email address, and this account has none.'
            );
        }

        $secret = Totp::secret();

        $user->totp_secret_encrypted = $secret;
        $user->totp_confirmed_at = null;

        // Reset with the secret. The high-water mark belongs to a secret, and
        // carrying it across a rotation would refuse the new authenticator's
        // first codes for as long as the old mark was ahead of the clock.
        $user->totp_last_used_step = null;
        $user->save();

        $this->recoveryCodes->revokeAll($user);

        return new Enrolment(
            secret: $secret,
            uri: $this->totp->uri($secret, $account, $issuer),
        );
    }

    /**
     * Prove the authenticator works, activate it, and hand back the recovery codes.
     *
     * The code is checked against the unconfirmed secret with the same window and
     * the same replay defence a sign-in challenge uses. It has to be: an enrolment
     * confirmation that accepted a code the challenge path would refuse is an
     * enrolment that appears to succeed and cannot then be used.
     *
     * @return ?list<string> the codes, for one response only, or null when the code was wrong
     */
    public function confirmEnrolment(User $user, string $code): ?array
    {
        $secret = $this->secretOf($user);

        if ($secret === null) {
            return null;
        }

        $step = $this->totp->matchingStep($secret, $code, Date::now()->getTimestamp());

        if ($step === null || ! $this->advanceStep($user, $step)) {
            // Audited as a failed challenge, because that is what it is. An
            // operator who cannot confirm is either mistyping or holding an
            // authenticator that was set up against a secret this account has
            // since rotated away, and the second one is worth being able to see
            // in the trail rather than inferring from a support conversation.
            $this->recordChallenge(
                $user,
                $step === null ? ChallengeOutcome::Rejected : ChallengeOutcome::Replayed,
                'enrolment',
            );

            return null;
        }

        $user->totp_confirmed_at = Date::now();
        $user->save();

        $codes = $this->recoveryCodes->issue($user);

        $this->recordEnrolment($user, 'challenge');

        return $codes;
    }

    /**
     * Enrol WITHOUT proving the authenticator first.
     *
     * Named to be uncomfortable to read, because it is the one path that turns a
     * secret into a working second factor with nothing verified. It exists for the
     * two cases the product genuinely has and no others:
     *
     *   - the FIRST platform operator, who cannot enrol through an endpoint that
     *     requires an already-enrolled session; and
     *   - an operator who has lost their authenticator, which
     *     docs/40-api/authentication-and-sessions.md § Second factor says is
     *     "recovered out of band, as a recorded administrative action".
     *
     * Its only caller is the console command, which is to say: whoever runs it
     * already has shell access to the application, and this hands them nothing
     * they did not already have. It is NOT reachable over HTTP and must not become
     * reachable -- an endpoint that enrols without a challenge is a password-only
     * path to a second factor, which is the exact hole this whole surface exists
     * to close.
     *
     * @return list<string> the recovery codes, printed once and never stored in the clear
     */
    public function activateWithoutChallenge(User $user, string $reason): array
    {
        $user->totp_confirmed_at = Date::now();
        $user->save();

        $codes = $this->recoveryCodes->issue($user);

        $this->recordEnrolment($user, $reason);

        return $codes;
    }

    /**
     * Check a code from a sign-in challenge.
     *
     * Everything about WHY it failed stays in the returned outcome and reaches the
     * audit trail; the caller renders one sentence for all of them.
     */
    public function verify(User $user, string $code): ChallengeOutcome
    {
        return $this->audited($user, $this->check($user, $code));
    }

    /**
     * The check itself, with no audit event and no side effect but the step
     * advance.
     *
     * Split out from verify() so that EVERY return path goes through
     * audited() -- an early return added here later cannot skip the trail,
     * because there is only one place the outcome leaves this class.
     */
    private function check(User $user, string $code): ChallengeOutcome
    {
        if (! $this->isEnrolled($user)) {
            return ChallengeOutcome::NotEnrolled;
        }

        $secret = $this->secretOf($user);

        if ($secret === null) {
            return ChallengeOutcome::NotEnrolled;
        }

        $step = $this->totp->matchingStep($secret, $code, Date::now()->getTimestamp());

        if ($step === null) {
            return ChallengeOutcome::Rejected;
        }

        // Arithmetically correct, but for a step already spent. See the class
        // docblock: this is a replay, and it is refused exactly as hard as a
        // wrong code while being recorded as something quite different.
        if (! $this->advanceStep($user, $step)) {
            return ChallengeOutcome::Replayed;
        }

        return ChallengeOutcome::Accepted;
    }

    /** Record the outcome of a sign-in challenge and hand it straight back. */
    private function audited(User $user, ChallengeOutcome $outcome): ChallengeOutcome
    {
        $this->recordChallenge($user, $outcome, 'sign_in');

        return $outcome;
    }

    /**
     * Spend a recovery code instead of a TOTP code.
     *
     * Only for an account that is actually enrolled. Recovery codes are the way
     * PAST a second factor, so honouring one on an account with no second factor
     * would be a credential that outlived the control it bypasses.
     */
    public function spendRecoveryCode(User $user, string $code): ChallengeOutcome
    {
        if (! $this->isEnrolled($user)) {
            return $this->audited($user, ChallengeOutcome::NotEnrolled);
        }

        if (! $this->recoveryCodes->spend($user, $code)) {
            return $this->audited($user, ChallengeOutcome::Rejected);
        }

        // TWO events, deliberately, and not one with a flag. A reviewer sweeping
        // the platform trail for "how did this session come to exist" reads
        // challenge outcomes; a reviewer asking "has anybody bypassed their
        // authenticator, and how many bypasses does that account have left"
        // reads this one. Collapsing them would make the second question a
        // filter over the first, which is how it stops being asked.
        //
        // WHAT IT OMITS: the recovery code. Not the code, not its digest, not
        // which of the ten it was. The count that remains is an operational
        // number -- an operator down to one is an operator about to be locked
        // out -- and it is the only thing here that could not be used to get in.
        $this->audit->record(
            'totp.recovery_code_spent',
            subjectType: 'User',
            subjectId: (string) $user->getKey(),
            metadata: [
                'recovery_codes_remaining' => $this->recoveryCodes->remaining($user),
            ],
            actor: $user,
        );

        return $this->audited($user, ChallengeOutcome::AcceptedByRecoveryCode);
    }

    /** How many recovery codes this account has left, for the audit event. */
    public function recoveryCodesRemaining(User $user): int
    {
        return $this->recoveryCodes->remaining($user);
    }

    /**
     * Advance the replay high-water mark, atomically.
     *
     * Returns false when the step has already been spent -- the UPDATE affected no
     * row -- which is the whole replay defence in one statement. The predicate is
     * written as raw SQL rather than a nested closure because the condition is a
     * single expression and the closure form buys nothing but a generic to satisfy.
     */
    private function advanceStep(User $user, int $step): bool
    {
        $affected = User::query()
            ->whereKey($user->getKey())
            ->whereRaw('(totp_last_used_step is null or totp_last_used_step < ?)', [$step])
            ->update(['totp_last_used_step' => $step]);

        if ($affected !== 1) {
            return false;
        }

        // Kept in step with the row, so a caller holding this instance does not
        // read a stale mark and accept the same code a second time in-process.
        $user->totp_last_used_step = $step;

        return true;
    }

    /**
     * The account's secret, decrypted, or null when there is none.
     *
     * Private, and it stays private. A public reader for a stored secret is how a
     * credential ends up in a debug endpoint, a support tool or a test fixture
     * somebody copied.
     */
    private function secretOf(User $user): ?string
    {
        $secret = $user->totp_secret_encrypted;

        return $secret === null || $secret === '' ? null : $secret;
    }

    /**
     * The challenge audit event, for every outcome including the failures.
     *
     * ============================================================
     * WHAT IT CARRIES, AND WHAT IT DELIBERATELY OMITS
     * ============================================================
     *
     * OMITTED: the code that was typed, the secret it was checked against, the
     * recovery code, the `otpauth://` URI, and the time step that matched. A
     * wrong code is a near-miss on a live credential and a right one is the
     * credential itself for ninety seconds; either in a permanently-retained
     * audit row is a second copy of the factor, sitting in the one table this
     * system is least willing to delete from. The step number is omitted for the
     * same reason in reverse -- it is enough to narrow a search of a captured
     * stream.
     *
     * CARRIED: which account, and WHICH OUTCOME. The outcome is the part worth
     * having. The person typing sees one sentence for a wrong code and a
     * replayed one -- telling them apart would tell an attacker whether they
     * hold a real code in the wrong window -- but a reviewer very much needs to
     * know that a code was REPLAYED, because a replay is somebody using a code
     * they observed rather than one they generated, and it is the only signal
     * this system gets that a code was captured.
     *
     * The event is emitted from HERE and not from the controller, so that no
     * caller can check a code without one being written. A controller that
     * forgot would be a hole nothing would notice.
     */
    private function recordChallenge(User $user, ChallengeOutcome $outcome, string $stage): void
    {
        $this->audit->record(
            $outcome->isAccepted() ? 'totp.challenge_succeeded' : 'totp.challenge_failed',
            subjectType: 'User',
            subjectId: (string) $user->getKey(),
            metadata: [
                'outcome' => $outcome->value,
                // 'sign_in' or 'enrolment'. A confirmation that fails is a
                // different operational story from a sign-in that fails.
                'stage' => $stage,
            ],
            actor: $user,
        );
    }

    /**
     * The enrolment audit event.
     *
     * WHAT IT DELIBERATELY OMITS: the secret, the `otpauth://` URI that contains
     * the secret, and every recovery code. What it carries is the account, who did
     * it, how it was authorised, and how many codes were issued -- which answers
     * "was a second factor enrolled on this account, when, and by what route"
     * without holding a single value that would let the reader use it.
     */
    private function recordEnrolment(User $user, string $method): void
    {
        $this->audit->record(
            'totp.enrolled',
            subjectType: 'User',
            subjectId: (string) $user->getKey(),
            metadata: [
                'method' => $method,
                'recovery_codes_issued' => RecoveryCodes::COUNT,
            ],
            actor: $user,
        );
    }
}
