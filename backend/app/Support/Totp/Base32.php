<?php

namespace App\Support\Totp;

use InvalidArgumentException;

/**
 * RFC 4648 base32, because that is the only alphabet an authenticator app reads.
 *
 * A TOTP secret is bytes. Every authenticator on a phone -- Google Authenticator,
 * Aegis, 1Password, FreeOTP -- takes it as base32 in an `otpauth://` URI, and
 * none of them takes hex or base64. So the encoding is not a preference here, it
 * is the interoperability requirement: get it wrong and the operator's phone
 * produces six digits that will never match, with nothing on either side to say
 * why.
 *
 * UPPERCASE AND UNPADDED, both deliberately. The '=' padding is legal and every
 * scanner accepts a string without it, while several of them choke on a URI with
 * '%3D' in the query string. Operators also RETYPE the secret when a camera will
 * not focus, and a lowercase 'l' next to a '1' in a hand-typed string is a
 * support call -- which is the same reason the RFC's alphabet omits 0, 1 and 8
 * entirely.
 *
 * Hand-written rather than pulled from a package for one reason, stated plainly:
 * nothing may be added to composer.lock in this change. `pragmarx/google2fa` and
 * `spomky-labs/otphp` both carry a reviewed implementation of exactly this, and
 * either is the better answer the moment a dependency can be added.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
final class Base32
{
    /** RFC 4648 §6. No 0, 1 or 8 -- they are the characters people mistype. */
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /**
     * Bytes to base32.
     *
     * Bit-by-bit through an accumulator rather than by chunking into groups of
     * five bytes, because the chunked form needs a separate branch for each of
     * the five possible remainders and four of those branches are never exercised
     * by a 20-byte secret. One loop that is always right beats five that are
     * usually not run.
     */
    public static function encode(string $bytes): string
    {
        $encoded = '';
        $buffer = 0;
        $bits = 0;

        foreach (str_split($bytes) as $byte) {
            $buffer = ($buffer << 8) | ord($byte);
            $bits += 8;

            while ($bits >= 5) {
                $bits -= 5;
                $encoded .= self::ALPHABET[($buffer >> $bits) & 31];
            }
        }

        // The tail: fewer than five bits left, padded out with zeroes on the
        // right, which is what the RFC specifies and what every decoder assumes.
        if ($bits > 0) {
            $encoded .= self::ALPHABET[($buffer << (5 - $bits)) & 31];
        }

        return $encoded;
    }

    /**
     * Base32 back to bytes.
     *
     * Tolerant of the two things a human does to a secret they retyped: spaces
     * every four characters, and lower case. Intolerant of anything else -- a
     * character outside the alphabet is a typo, and silently dropping it would
     * decode to a DIFFERENT secret that verifies nothing, which is far harder to
     * diagnose than a refusal.
     *
     * @throws InvalidArgumentException when the input is not base32
     */
    public static function decode(string $encoded): string
    {
        $normalised = strtoupper(str_replace([' ', '-', '='], '', $encoded));

        if ($normalised === '') {
            return '';
        }

        $bytes = '';
        $buffer = 0;
        $bits = 0;

        foreach (str_split($normalised) as $character) {
            $value = strpos(self::ALPHABET, $character);

            if ($value === false) {
                throw new InvalidArgumentException('Not a base32 string.');
            }

            $buffer = ($buffer << 5) | $value;
            $bits += 5;

            if ($bits >= 8) {
                $bits -= 8;
                $bytes .= chr(($buffer >> $bits) & 255);
            }
        }

        // Leftover bits are the encoder's padding and are discarded. They are
        // never part of the secret.
        return $bytes;
    }
}
