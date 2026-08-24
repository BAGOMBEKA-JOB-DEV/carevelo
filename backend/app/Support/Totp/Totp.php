<?php

namespace App\Support\Totp;

/**
 * RFC 6238 time-based one-time passwords, in about forty lines over hash_hmac.
 *
 * ============================================================
 * WHY THIS IS HAND-WRITTEN, AND WHAT SHOULD REPLACE IT
 * ============================================================
 *
 * Nothing may be added to composer.lock in the change that introduced this file,
 * so `pragmarx/google2fa` and `spomky-labs/otphp` -- both reviewed, both
 * maintained, both doing exactly this -- were not options. The algorithm itself
 * is small and completely specified: HMAC-SHA1 over the big-endian time step,
 * RFC 4226's dynamic truncation, modulo ten to the sixth. There is no room in it
 * for a clever variation, which is the only reason writing it out is defensible.
 *
 * If a dependency can be added later, replacing this class with one of those two
 * is a good trade and the interface below is deliberately the shape they expose.
 * What must NOT happen is a second implementation appearing beside it.
 *
 * ============================================================
 * THE THREE THINGS THAT MAKE A TOTP CHECK WRONG
 * ============================================================
 *
 * 1. A NON-CONSTANT-TIME COMPARISON. `===` on the code returns early at the first
 *    differing character, and six digits is a small enough space that the
 *    difference is measurable over a network. Every comparison here is
 *    hash_equals, and matchingStep() checks ALL of the permitted steps rather
 *    than returning at the first hit, so the work does not depend on which step
 *    matched.
 *
 * 2. TOO WIDE A SKEW WINDOW. A window of plus or minus one step accepts a code
 *    for ninety seconds, which is what an unsynchronised phone actually needs.
 *    Widening it to plus or minus two or three -- which reads as harmless and is
 *    what most "fix the clock drift complaints" patches do -- multiplies the
 *    number of live codes at any instant and stretches the replay window with it.
 *    SKEW_STEPS is 1 and the tests refuse a code from step -2 and +2 explicitly.
 *
 * 3. ACCEPTING A CODE TWICE. RFC 6238 §5.2: the verifier MUST NOT accept a second
 *    authentication for the same time step. That is not enforced here, because it
 *    needs state; TotpAuthenticator owns it, with a monotonic
 *    `users.totp_last_used_step` advanced by a conditional UPDATE.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
final class Totp
{
    /** Thirty seconds. Every authenticator app assumes it; it is not configurable in practice. */
    public const PERIOD = 30;

    public const DIGITS = 6;

    /**
     * SHA-1, and that is not an oversight.
     *
     * TOTP's use of SHA-1 is inside an HMAC, where the collision weaknesses that
     * retired SHA-1 for signatures do not apply, and it is what the installed
     * base of authenticator apps defaults to. Choosing SHA-256 here would look
     * stronger on a checklist and would produce codes that half the phones in the
     * world compute differently, with no error message anywhere.
     */
    public const ALGORITHM = 'sha1';

    /**
     * One step either side, and NO MORE. Read the class docblock before changing this.
     */
    public const SKEW_STEPS = 1;

    /** 160 bits, matching the HMAC-SHA1 block the RFC's test vectors use. */
    public const SECRET_BYTES = 20;

    /**
     * The issuer every enrolment is labelled with, and it is a literal.
     *
     * NOT config('app.name'). Two reasons, and the second is the serious one.
     * The shipped .env.example carries APP_NAME=Laravel, so a deployment that
     * never set it would enrol operators against an issuer named after the
     * framework. And the issuer is part of what an authenticator app DISPLAYS
     * and, in several apps, part of what it keys the entry on -- so changing
     * APP_NAME later would silently orphan every enrolment already in the field,
     * with no error anywhere and no way to tell from the server that it had
     * happened. A brand name is not a configurable, and this one is pinned.
     */
    public const ISSUER = 'Carevelo';

    /**
     * A fresh secret, base32-encoded.
     *
     * random_bytes and nothing else. rand() and mt_rand() are seeded pseudo-random
     * generators whose output is predictable from a handful of observations, and a
     * predictable second factor is not a second factor -- it is a slower way of
     * writing "true".
     */
    public static function secret(): string
    {
        return Base32::encode(random_bytes(self::SECRET_BYTES));
    }

    /** The time step a given instant falls in. */
    public function step(int $timestamp): int
    {
        return intdiv($timestamp, self::PERIOD);
    }

    /**
     * The six digits for one step.
     *
     * pack('J', ...) is a 64-bit BIG-ENDIAN unsigned integer, which is what RFC
     * 4226 specifies for the counter. Little-endian here produces codes that are
     * internally consistent and match no authenticator app on earth.
     */
    public function code(string $secret, int $step): string
    {
        $hash = hash_hmac(self::ALGORITHM, pack('J', $step), Base32::decode($secret), true);

        // Dynamic truncation, RFC 4226 §5.3. The low nibble of the last byte
        // chooses where in the digest to read from, so the four bytes used are
        // not a fixed slice an attacker can target.
        $offset = ord($hash[strlen($hash) - 1]) & 0x0F;

        $truncated = ((ord($hash[$offset]) & 0x7F) << 24)
            | ((ord($hash[$offset + 1]) & 0xFF) << 16)
            | ((ord($hash[$offset + 2]) & 0xFF) << 8)
            | (ord($hash[$offset + 3]) & 0xFF);

        return str_pad(
            (string) ($truncated % (10 ** self::DIGITS)),
            self::DIGITS,
            '0',
            STR_PAD_LEFT,
        );
    }

    /**
     * The step this code belongs to, or null if it belongs to none of the permitted ones.
     *
     * The step is RETURNED rather than a boolean because the caller has to record
     * it: replay defence is "this step has already been spent", and a caller told
     * only "yes" has nothing to write down.
     *
     * EVERY permitted step is computed and compared, with no early return. The
     * loop therefore costs the same whether the match was early, late or absent,
     * so nothing about which step matched -- or whether one did -- is observable
     * from how long the request took.
     */
    public function matchingStep(string $secret, string $code, int $timestamp): ?int
    {
        $current = $this->step($timestamp);
        $matched = null;

        for ($offset = -self::SKEW_STEPS; $offset <= self::SKEW_STEPS; $offset++) {
            $step = $current + $offset;

            // Argument order is (known, supplied), which is hash_equals's own
            // contract: it is constant-time in the length of the first argument.
            if (hash_equals($this->code($secret, $step), $code)) {
                $matched = $step;
            }
        }

        return $matched;
    }

    /**
     * The `otpauth://` URI an authenticator app scans.
     *
     * ============================================================
     * $account IS THE OPERATOR'S EMAIL ADDRESS. NEVER A PHONE NUMBER.
     * ============================================================
     *
     * The URI this builds looks like
     *
     *     otpauth://totp/Carevelo:ops@example.com?secret=...&issuer=Carevelo
     *
     * and the part after the colon is the operator's email address, because an
     * email address and a password is the whole of how a platform account signs
     * in (App\Support\Auth\PlatformAccounts scopes its lookup to
     * `tenant_id is null` and matches on `lower(email)`; there is no other
     * identifier on that surface). Every caller passes `$user->email` and the
     * tests assert the label verbatim.
     *
     * IT MUST NOT BECOME A PHONE NUMBER, and this is not a style preference.
     * This product HAD a phone one-time-code sign-in and removed it on purpose
     * -- `2026_08_17_171200_drop_otp_codes_table.php` is the migration that
     * records the removal, and docs/40-api/authentication-and-sessions.md is
     * blunt about it: "TOTP, and only TOTP. There is no SMS fallback, because
     * the platform sends no codes at all -- which also removes SIM swap as a way
     * past a second factor."
     *
     * The reason to write it out HERE, at the line that builds the label, is
     * that this is the one place where putting a phone number in would look like
     * a small improvement. It is not. A second factor delivered to, or keyed on,
     * a mobile number is one SIM swap away from being no second factor at all --
     * a call to a mobile operator's customer service, an intercepted number, and
     * the factor belongs to somebody else. And the account this protects is the
     * one that can authorise a BREAK-GLASS GRANT into a clinic's patient
     * records: the single highest-value session in the product, guarding
     * special-category health data for people who never chose us as their
     * processor. There is no phone column on this surface, nothing here reads
     * one, and nothing here may start.
     *
     * A LABEL IS NOT A SECRET, and passing an email address is safe in a way
     * passing an internal id would not be USEFUL: the operator scanning this is
     * the person whose address it is, and an unlabelled entry -- or one labelled
     * with a ULID -- is how somebody with three Carevelo-adjacent accounts on
     * one device picks the wrong six digits at 3am during an incident.
     *
     * ============================================================
     * THE ISSUER APPEARS TWICE, AND THAT IS THE FORMAT
     * ============================================================
     *
     * Once in the path and once as a parameter, which looks redundant and is
     * what the Key URI format requires: older apps read the path, newer ones
     * read the parameter, and an operator whose authenticator shows an
     * unlabelled six-digit code cannot tell which of their accounts it belongs
     * to.
     *
     * THIS STRING CONTAINS THE SECRET. It is returned to the enrolling operator
     * exactly once and is never logged, never audited and never stored. The
     * audit event for an enrolment records that one happened and to which
     * account, and carries neither this URI nor the secret inside it.
     *
     * @param  string  $account  the operator's email address -- see above
     */
    public function uri(string $secret, string $account, string $issuer): string
    {
        return sprintf(
            'otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=%s&digits=%d&period=%d',
            self::label($issuer),
            self::label($account),
            $secret,
            rawurlencode($issuer),
            strtoupper(self::ALGORITHM),
            self::DIGITS,
            self::PERIOD,
        );
    }

    /**
     * One half of the label, encoded for a URI PATH segment.
     *
     * rawurlencode() encodes for a QUERY segment, which is stricter than the
     * path needs and turns the '@' in every email address into '%40'. That is
     * legal, and it is not what the Key URI format's own examples look like --
     * they are written `otpauth://totp/Example:alice@google.com` -- nor what
     * this product's specification writes. RFC 3986 § 3.3 lists '@' among the
     * characters a path segment may carry unescaped, so putting it back is
     * correct rather than lenient, and it is the difference between an operator
     * seeing their own address in their authenticator and seeing it with a
     * percent-escape in the middle of it.
     *
     * Nothing else is relaxed. A ':' would break the issuer/account split, a
     * '/' would break the path, and both stay encoded.
     */
    private static function label(string $value): string
    {
        return str_replace('%40', '@', rawurlencode($value));
    }
}
