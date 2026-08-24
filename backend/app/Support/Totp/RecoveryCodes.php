<?php

namespace App\Support\Totp;

use App\Models\TotpRecoveryCode;
use App\Models\User;
use Illuminate\Support\Facades\Date;

/**
 * The way back in when the authenticator is gone, and the only one that does not
 * involve a person.
 *
 * ============================================================
 * WHY THESE EXIST AT ALL
 * ============================================================
 *
 * TOTP is mandatory for a platform operator, and a mandatory second factor with
 * no recovery path is an outage waiting for a dropped phone -- at, by the nature
 * of the job, the moment somebody is trying to reach a clinic that cannot work.
 * The documented recovery is out of band and administrative
 * (docs/40-api/authentication-and-sessions.md § Second factor); these codes are
 * the same act, performed in advance and by the operator themselves.
 *
 * ============================================================
 * THE FOUR PROPERTIES, AND WHAT EACH ONE COSTS
 * ============================================================
 *
 * SHOWN EXACTLY ONCE. The plaintext exists in one HTTP response and nowhere else
 * -- not in a session, not in a log, not in an audit event, not in a second
 * "show my codes" endpoint. An operator who did not write them down enrols again.
 *
 * HASHED AT REST. What is stored cannot be turned back into a code. A database
 * dump therefore hands an attacker a list of digests of ten values they cannot
 * guess, rather than ten standing bypasses of the second factor.
 *
 * SINGLE USE. `used_at` is set inside a conditional UPDATE, so two requests
 * racing on the same code produce exactly one winner. A code that could be
 * replayed is a static password with extra ceremony.
 *
 * CONSTANT-TIME COMPARISON. Every unspent code is compared with hash_equals and
 * the loop does not stop at the match, so the time taken does not reveal how far
 * down the list the accepted code was -- or that none of them matched.
 *
 * ============================================================
 * SHA-256 AND NOT BCRYPT, WHICH IS A DELIBERATE DEPARTURE
 * ============================================================
 *
 * Passwords in this system are bcrypt, correctly: a human-chosen password has
 * perhaps thirty bits of entropy and needs the work factor to make a dictionary
 * run expensive. A recovery code is eighty bits from random_bytes. There is no
 * dictionary to run against it, so the work factor buys nothing -- and it costs
 * something real, because verifying one code means comparing against every
 * unspent code on the account. Ten bcrypt comparisons at the configured cost is
 * multiple seconds of CPU on a request that is already the sign-in path, which is
 * a denial-of-service handed to anyone who can post a wrong code.
 *
 * The property that matters here is preimage resistance over a high-entropy
 * input, and SHA-256 has it.
 */
final class RecoveryCodes
{
    /**
     * Ten. Enough that an operator can spend a few over a couple of years without
     * thinking about it, few enough that the sheet is short enough to actually
     * keep.
     */
    public const COUNT = 10;

    /** 80 bits per code. Nothing guesses that, and nothing needs stretching to resist a guess. */
    private const BYTES = 10;

    /**
     * A fresh set, replacing whatever the account had.
     *
     * REPLACING, not adding to. These are issued when a secret is enrolled, and
     * codes minted against a secret that has been rotated away must not survive
     * it -- otherwise rotating the authenticator, which is what an operator does
     * when they think their old one is compromised, leaves ten bypasses in place.
     *
     * @return list<string> the plaintext codes, for one response and no other purpose
     */
    public function issue(User $user): array
    {
        $this->revokeAll($user);

        $codes = [];

        for ($index = 0; $index < self::COUNT; $index++) {
            // Minted, hashed and formatted in that order, so the digest is taken
            // over the NORMALISED form -- the same form spend() digests what it
            // was given. Hashing the pretty, hyphenated string instead is how a
            // set of codes comes out of enrolment that can never be spent, and
            // nothing would notice until an operator actually needed one.
            $raw = Base32::encode(random_bytes(self::BYTES));

            $codes[] = implode('-', str_split($raw, 4));

            TotpRecoveryCode::create([
                'user_id' => $user->getKey(),
                'code_hash' => $this->digest($raw),
            ]);
        }

        return $codes;
    }

    /**
     * Spend a code, if it is one of this account's and has not been spent.
     *
     * The conditional UPDATE is what makes "exactly once" true under concurrency
     * rather than nearly always: two requests carrying the same code both find the
     * row unspent, both issue the update, and PostgreSQL lets exactly one of them
     * see a row affected. The loser is told the code is wrong, which it now is.
     */
    public function spend(User $user, string $candidate): bool
    {
        $digest = $this->digest($this->normalise($candidate));

        /** @var list<TotpRecoveryCode> $unspent */
        $unspent = TotpRecoveryCode::query()
            ->where('user_id', $user->getKey())
            ->whereNull('used_at')
            ->get()
            ->all();

        $matched = null;

        foreach ($unspent as $stored) {
            // No `break`. Stopping at the match would make the request faster for
            // a code near the top of the list than one near the bottom, and the
            // position of a code in the list is a fact about the credential.
            if (hash_equals($stored->code_hash, $digest)) {
                $matched = $stored;
            }
        }

        if ($matched === null) {
            return false;
        }

        $affected = TotpRecoveryCode::query()
            ->whereKey($matched->getKey())
            ->whereNull('used_at')
            ->update(['used_at' => Date::now()]);

        return $affected === 1;
    }

    /**
     * Destroy every code on the account, spent or not.
     *
     * DELETED here rather than marked spent, which is the one place this table
     * does destroy a row and is a different act from spending one. A revoked set
     * belongs to a secret that no longer exists, so there is nothing left for the
     * register of "which code was spent, and when" to be a register OF -- and
     * keeping digests of codes that can never be presented again would only grow
     * the number of live-looking credentials in a database dump.
     */
    public function revokeAll(User $user): void
    {
        TotpRecoveryCode::query()->where('user_id', $user->getKey())->delete();
    }

    /** How many are left, for the audit event that records one being spent. */
    public function remaining(User $user): int
    {
        return TotpRecoveryCode::query()
            ->where('user_id', $user->getKey())
            ->whereNull('used_at')
            ->count();
    }

    /**
     * Case, spaces and grouping are not part of the credential. The codes are
     * SHOWN grouped in fours because they get read down a telephone and typed by
     * hand, and the grouping is cosmetic on both sides of that.
     *
     * The alphabet is uppercase base32, so lowercasing what was typed and
     * discarding separators removes the two ways a correct code is refused,
     * without widening what counts as correct.
     */
    private function normalise(string $code): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');
    }

    /**
     * The digest, and the only form of a code this system keeps.
     *
     * See the class docblock for why this is not bcrypt.
     */
    private function digest(string $code): string
    {
        return hash('sha256', $code);
    }
}
