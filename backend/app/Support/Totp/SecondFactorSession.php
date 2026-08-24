<?php

namespace App\Support\Totp;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;

/**
 * The two pieces of session state that make a platform sign-in two steps.
 *
 * ============================================================
 * THE PASSWORD STEP DOES NOT SIGN ANYBODY IN
 * ============================================================
 *
 * This is the design decision worth arguing with, so it is written down. The
 * obvious shape for a two-step sign-in is: authenticate on the password, mark the
 * session "second factor outstanding", and have middleware refuse everything
 * until it is discharged. That is exactly how RequirePasswordChange works, and it
 * is the wrong shape HERE.
 *
 * The difference is what the session is worth in the meantime. A patient holding
 * a password-change-outstanding session has an ordinary tenant session that
 * middleware narrows. A platform operator holding a second-factor-outstanding
 * session would have a session for an account with NO tenant, and `auth:sanctum`
 * is not confined to the platform routes -- the same cookie reaches every /v1
 * route on every clinic host, where ResolveTenant's host check passes trivially
 * because a platform account's tenant_id is null. Middleware on the platform
 * group would not be anywhere near it.
 *
 * So the password step stores a PENDING CHALLENGE in the session and calls no
 * guard. Until the code is right there is no authenticated session at all, and
 * "a platform operator cannot authenticate without a second factor" is true by
 * construction rather than by a list of routes somebody has to keep correct.
 *
 * RequireSecondFactor still exists and still guards the whole platform group,
 * reading the stamp this class writes. That is not redundancy for its own sake:
 * it is what holds if a future change ever introduces another way to log a
 * platform account in -- an impersonation tool, a test helper, a console command
 * that opens a session. The rule is then still enforced at the group.
 *
 * ============================================================
 * BOTH VALUES ARE BOUND TO A USER ID
 * ============================================================
 *
 * Neither key is a bare flag. A stamp that said only "the second factor was
 * satisfied" would still be sitting in the session if the same session later
 * authenticated as somebody else, and would hand that account a factor it never
 * passed. Both are compared against the account they were issued for.
 */
final class SecondFactorSession
{
    /** The half-finished sign-in: a password accepted, a code not yet given. */
    private const PENDING_KEY = 'platform.pending_challenge';

    /** The finished one: this session passed a second factor for this account. */
    private const VERIFIED_KEY = 'platform.second_factor';

    /**
     * Five minutes to type six digits.
     *
     * Long enough to unlock a phone, find the right entry and read it; short
     * enough that a pending challenge left on a shared machine is not a standing
     * invitation. It is not a session timeout -- the operator has not got a
     * session yet -- it is the lifetime of a proven password, and a proven
     * password is precisely what an attacker who walks up to an unattended
     * browser would otherwise inherit.
     */
    public const PENDING_TTL_SECONDS = 300;

    /**
     * Record that a password was accepted, and start the clock.
     *
     * The session id is regenerated FIRST. An attacker who planted a session id on
     * a shared machine must not be holding the session that a password was just
     * proved into -- the same reasoning SessionRegistry::start() applies at the
     * moment of login, applied here at the moment the session first becomes worth
     * stealing.
     */
    public function beginChallenge(Request $request, User $user): void
    {
        if (! $request->hasSession()) {
            return;
        }

        $request->session()->regenerate();

        $request->session()->put(self::PENDING_KEY, [
            'user_id' => (string) $user->getKey(),
            'expires_at' => Date::now()->addSeconds(self::PENDING_TTL_SECONDS)->getTimestamp(),
        ]);
    }

    /**
     * The account a pending challenge belongs to, if there is a live one.
     *
     * An expired challenge is discarded rather than merely ignored, so a stale
     * entry cannot be revived by a clock change and does not sit in the session
     * store naming an account for longer than its five minutes.
     */
    public function pendingUserId(Request $request): ?string
    {
        if (! $request->hasSession()) {
            return null;
        }

        $pending = $request->session()->get(self::PENDING_KEY);

        if (! is_array($pending)) {
            return null;
        }

        $userId = $pending['user_id'] ?? null;
        $expiresAt = $pending['expires_at'] ?? null;

        if (! is_string($userId) || ! is_int($expiresAt)) {
            return null;
        }

        if ($expiresAt < Date::now()->getTimestamp()) {
            $this->clearChallenge($request);

            return null;
        }

        return $userId;
    }

    public function clearChallenge(Request $request): void
    {
        if ($request->hasSession()) {
            $request->session()->forget(self::PENDING_KEY);
        }
    }

    /**
     * Stamp this session as having passed the second factor for this account.
     *
     * Written AFTER the guard has logged the user in and the session id has been
     * regenerated, so the stamp lands on the identifier the operator will actually
     * carry rather than on the one that is about to be discarded.
     */
    public function markVerified(Request $request, User $user): void
    {
        if (! $request->hasSession()) {
            return;
        }

        $request->session()->put(self::VERIFIED_KEY, [
            'user_id' => (string) $user->getKey(),
            'verified_at' => Date::now()->getTimestamp(),
        ]);
    }

    /** Whether THIS session passed a second factor for THIS account. */
    public function hasVerified(Request $request, User $user): bool
    {
        if (! $request->hasSession()) {
            return false;
        }

        $stamp = $request->session()->get(self::VERIFIED_KEY);

        if (! is_array($stamp)) {
            return false;
        }

        $userId = $stamp['user_id'] ?? null;

        return is_string($userId) && hash_equals((string) $user->getKey(), $userId);
    }

    /** Sign-out, and any other point at which the session stops meaning anything. */
    public function forget(Request $request): void
    {
        if ($request->hasSession()) {
            $request->session()->forget([self::PENDING_KEY, self::VERIFIED_KEY]);
        }
    }

    /**
     * The stamp, as a session payload.
     *
     * Exposed so that a TEST can put a platform session into the state a real
     * challenge produces, without reaching for the key names. Tests that guessed
     * the key would keep passing after it changed, which on this control means a
     * suite that asserts a gate nobody is standing behind.
     *
     * @return array<string, array<string, int|string>>
     */
    public static function verifiedState(User $user): array
    {
        return [
            self::VERIFIED_KEY => [
                'user_id' => (string) $user->getKey(),
                'verified_at' => Date::now()->getTimestamp(),
            ],
        ];
    }
}
