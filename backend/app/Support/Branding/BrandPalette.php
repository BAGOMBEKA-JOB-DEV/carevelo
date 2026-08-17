<?php

namespace App\Support\Branding;

/**
 * A clinic's colours, resolved into the token set the browser is given.
 *
 * White-labeling is the product rather than a theme setting, and the tokens are the
 * whole of it: a clinic gets colours and a logo, never CSS. Free-form CSS in a
 * multi-tenant health application is a cross-site scripting vector and, given what
 * is on these screens, an exfiltration vector for special-category data.
 *
 * FOREGROUNDS ARE COMPUTED, NEVER CHOSEN. A clinic that picks pale yellow gets
 * readable text anyway. This is not a preference being overridden lightly -- an
 * unreadable dosage instruction is a safety problem, not a taste problem.
 *
 * Framework-free on purpose, like Money and PhoneNumber alongside it: colour maths
 * unit-tests without booting anything, and the property test that guards the AA
 * guarantee sweeps hundreds of thousands of colours, which it could not do through
 * HTTP.
 *
 * This logic lived as private statics on TenantAdminResource, where the
 * patient-facing TenantResource could not reach it -- so the one surface that
 * absolutely must stay readable was the one receiving raw colours and no computed
 * foreground at all.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
final readonly class BrandPalette
{
    /**
     * `#RRGGBB` and nothing else: not a colour keyword, not rgb(), not a URL.
     *
     * The D modifier is load-bearing. Without it PHP's `$` also matches before a
     * trailing newline, so "#FF0000\n" passes -- and a value that reaches a CSS
     * custom property with a newline in it is the beginning of an escape. This
     * constant is the single definition; UpdateTenantRequest validates entry against
     * it rather than keeping a second copy that can drift.
     */
    public const HEX = '/^#[0-9a-fA-F]{6}$/D';

    /** WCAG 2.1 AA for normal-size text. */
    public const AA_NORMAL_TEXT = 4.5;

    /** WCAG 2.1 AA for large text, logos and UI furniture. */
    public const AA_LARGE_TEXT = 3.0;

    /**
     * The light foreground option.
     */
    private const LIGHT_INK = '#FFFFFF';

    /**
     * The dark foreground option, and it is pure black deliberately.
     *
     * This was '#111111', which looks gentler and fails the promise. Paired with
     * white, near-black leaves a band of ordinary colours where NEITHER option
     * reaches AA: sweeping the space at 4-unit steps, 9,217 of 262,144 colours
     * failed, the worst being #E43430 -- an unremarkable red -- at 4.35:1. A clinic
     * with a red logo got button text below AA, and the tests missed it because they
     * asserted two example colours that both sat outside the failing band.
     *
     * With pure black the failure count is zero for every colour sampled, and
     * BrandPalettePropertyTest is what keeps it that way.
     *
     * Worth being clear about what this colour is for: it is ink ON a brand-coloured
     * surface -- a button label, a filled badge -- not body text, which uses the
     * ink tokens and is never pure black.
     */
    private const DARK_INK = '#000000';

    private function __construct(
        public ?string $primary,
        public ?string $primaryForeground,
        public ?string $secondary,
        public ?string $secondaryForeground,
        public ?string $surface,
    ) {}

    /**
     * Resolve a palette from two stored values.
     *
     * Re-validates both. Belt and braces over the entry validation, which is the
     * real control: "it was validated when it was written" is a claim about history
     * rather than about this string, and this string is about to become a CSS custom
     * property.
     */
    public static function from(mixed $primary, mixed $secondary): self
    {
        $primaryHex = self::hexOrNull($primary);
        $secondaryHex = self::hexOrNull($secondary);

        return new self(
            primary: $primaryHex,
            primaryForeground: self::readableForeground($primaryHex),
            secondary: $secondaryHex,
            secondaryForeground: self::readableForeground($secondaryHex),
            surface: self::surfaceFrom($primaryHex),
        );
    }

    /**
     * The token set, as the client receives it.
     *
     * @return array{primary_colour: ?string, primary_foreground: ?string, secondary_colour: ?string, secondary_foreground: ?string, surface: ?string}
     */
    public function toTokens(): array
    {
        return [
            'primary_colour' => $this->primary,
            'primary_foreground' => $this->primaryForeground,
            'secondary_colour' => $this->secondary,
            'secondary_foreground' => $this->secondaryForeground,
            'surface' => $this->surface,
        ];
    }

    /**
     * Warnings the administrator sees while the choice is still cheap to change.
     *
     * Advisory rather than a validation failure: the portal stays readable either
     * way, because the foreground is computed. Refusing the colour outright would be
     * overreach -- it is the clinic's brand.
     *
     * Admin-only. A patient's browser has no use for guidance aimed at whoever
     * picked the colour.
     *
     * @return list<string>
     */
    public function advisories(): array
    {
        $advisories = [];

        foreach (['primary' => $this->primary, 'secondary' => $this->secondary] as $name => $hex) {
            if ($hex === null) {
                continue;
            }

            if (self::contrastRatio($hex, self::LIGHT_INK) < self::AA_LARGE_TEXT) {
                $advisories[] = sprintf(
                    'The %s colour is very pale against white. Patient-facing text will use a dark '
                    .'foreground so it stays readable; a deeper shade would carry the brand better.',
                    $name,
                );
            }
        }

        if (
            $this->primary !== null
            && $this->secondary !== null
            && self::contrastRatio($this->primary, $this->secondary) < self::AA_NORMAL_TEXT
        ) {
            $advisories[] = 'The primary and secondary colours are close together, so the two will be hard '
                .'to tell apart on screen.';
        }

        return $advisories;
    }

    /**
     * Black or white, whichever the clinic's colour can actually carry.
     */
    public static function readableForeground(?string $hex): ?string
    {
        if ($hex === null) {
            return null;
        }

        return self::contrastRatio($hex, self::LIGHT_INK) >= self::contrastRatio($hex, self::DARK_INK)
            ? self::LIGHT_INK
            : self::DARK_INK;
    }

    /**
     * A quiet tint of the brand, for cards and banded areas.
     *
     * `--brand-surface` is named as "derived" in the white-labeling document and
     * nothing derived it until now. Mixed heavily towards white so it stays
     * decisively a background: text sits on top of it using the ordinary ink
     * tokens, so a tint that crept towards mid-strength would quietly reduce the
     * contrast of everything placed on it.
     */
    public static function surfaceFrom(?string $hex): ?string
    {
        if ($hex === null) {
            return null;
        }

        [$r, $g, $b] = self::channels($hex);

        // 8% brand, 92% white.
        $mix = static fn (int $channel): int => (int) round($channel * 0.08 + 255 * 0.92);

        return sprintf('#%02X%02X%02X', $mix($r), $mix($g), $mix($b));
    }

    /**
     * WCAG 2.1 contrast ratio between two `#RRGGBB` values.
     */
    public static function contrastRatio(string $hex, string $other): float
    {
        $first = self::relativeLuminance($hex);
        $second = self::relativeLuminance($other);

        return (max($first, $second) + 0.05) / (min($first, $second) + 0.05);
    }

    /**
     * WCAG 2.1 relative luminance of a `#RRGGBB` value.
     */
    public static function relativeLuminance(string $hex): float
    {
        [$r, $g, $b] = array_map(
            static function (int $channel): float {
                $srgb = $channel / 255;

                return $srgb <= 0.04045
                    ? $srgb / 12.92
                    : (($srgb + 0.055) / 1.055) ** 2.4;
            },
            self::channels($hex),
        );

        return 0.2126 * $r + 0.7152 * $g + 0.0722 * $b;
    }

    /**
     * @return array{int, int, int}
     */
    private static function channels(string $hex): array
    {
        $digits = ltrim($hex, '#');

        return [
            (int) hexdec(substr($digits, 0, 2)),
            (int) hexdec(substr($digits, 2, 2)),
            (int) hexdec(substr($digits, 4, 2)),
        ];
    }

    private static function hexOrNull(mixed $value): ?string
    {
        return is_string($value) && preg_match(self::HEX, $value) === 1 ? $value : null;
    }
}
