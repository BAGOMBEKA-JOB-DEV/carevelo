<?php

namespace App\Support;

use App\Casts\PhoneNumberCast;
use Illuminate\Contracts\Database\Eloquent\Castable;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use InvalidArgumentException;
use JsonSerializable;
use Stringable;

/**
 * A Ugandan phone number, normalised to E.164.
 *
 * The phone number is the primary credential in this system: most Ugandan
 * clinic staff and nearly all patients have a working phone and no reliably
 * checked email address. It is also how appointment details, payment prompts
 * and prescription-ready notifications reach people, so an inconsistently
 * stored number sends someone else's health information to a stranger.
 *
 * Ugandans write the same number at least six ways:
 *
 *     0772123456      +256772123456     256772123456
 *     0772 123 456    +256 772 123456   (+256) 772-123-456
 *
 * Normalising once at the boundary removes an entire class of duplicate-account
 * bugs and makes (tenant_id, phone) a usable uniqueness constraint.
 *
 * @see docs/20-domain/identifiers-and-numbering.md
 */
final class PhoneNumber implements Castable, JsonSerializable, Stringable
{
    private const COUNTRY_CODE = '256';

    /** Uganda's national significant number is 9 digits after the leading 0. */
    private const NSN_LENGTH = 9;

    private function __construct(public readonly string $e164) {}

    /**
     * @throws InvalidArgumentException when the value is not a valid Ugandan number
     */
    public static function parse(string $raw): self
    {
        $digits = preg_replace('/\D+/', '', $raw) ?? '';

        if (str_starts_with($digits, '0')) {
            $digits = substr($digits, 1);
        }

        if (str_starts_with($digits, self::COUNTRY_CODE)) {
            $digits = substr($digits, strlen(self::COUNTRY_CODE));
        }

        // Mobile prefixes begin 7; landlines begin 2 or 3. Both are accepted —
        // a clinic's desk line is a legitimate contact — but anything else is
        // a typo, rejected here rather than stored and failed later at the SMS
        // gateway.
        if (strlen($digits) !== self::NSN_LENGTH || preg_match('/^[723]/', $digits) !== 1) {
            throw new InvalidArgumentException(
                'Enter a valid Ugandan phone number, for example 0772 123 456.'
            );
        }

        return new self('+'.self::COUNTRY_CODE.$digits);
    }

    public static function tryParse(?string $raw): ?self
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }

        try {
            return self::parse($raw);
        } catch (InvalidArgumentException) {
            return null;
        }
    }

    /**
     * @return class-string<CastsAttributes<PhoneNumber, PhoneNumber|string>>
     */
    public static function castUsing(array $arguments): string
    {
        return PhoneNumberCast::class;
    }

    public function isMobile(): bool
    {
        return str_starts_with($this->nationalSignificantNumber(), '7');
    }

    public function nationalSignificantNumber(): string
    {
        return substr($this->e164, 1 + strlen(self::COUNTRY_CODE));
    }

    /** Local display: 0772 123 456. */
    public function formatNational(): string
    {
        $nsn = $this->nationalSignificantNumber();

        return sprintf('0%s %s %s', substr($nsn, 0, 3), substr($nsn, 3, 3), substr($nsn, 6, 3));
    }

    /**
     * Partially masked, for support tooling and anywhere the full number is not
     * needed: 0772 *** 456.
     */
    public function masked(): string
    {
        $nsn = $this->nationalSignificantNumber();

        return sprintf('0%s *** %s', substr($nsn, 0, 3), substr($nsn, 6, 3));
    }

    public function equals(self $other): bool
    {
        return $this->e164 === $other->e164;
    }

    public function __toString(): string
    {
        return $this->e164;
    }

    public function jsonSerialize(): string
    {
        return $this->e164;
    }
}
