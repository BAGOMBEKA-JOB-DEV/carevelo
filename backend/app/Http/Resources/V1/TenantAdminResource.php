<?php

namespace App\Http\Resources\V1;

use App\Models\Tenant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

/**
 * The clinic as its own administrator sees it.
 *
 * Distinct from TenantResource, which is public and deliberately narrower. This
 * one carries the compliance references and the onboarding state, and it is
 * reachable only by an administrator of this clinic.
 *
 * TWO THINGS ARE STRUCTURAL RATHER THAN COMPUTED FROM DATA.
 *
 * `compliance.verified_by_carevelo` is a hard-coded false. It is not a column,
 * because a column can be set. Carevelo has no access to the UMDPC or NDA
 * registers, performs no lookup against them, and a response shape that could
 * ever say otherwise would eventually say it -- to a patient who might rely on
 * it.
 *
 * `branding.*_foreground` is COMPUTED, never chosen. A clinic that picks pale
 * yellow still gets readable text, because an unreadable dosage instruction is
 * a safety problem rather than a taste problem.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 3
 *
 * @mixin Tenant
 */
class TenantAdminResource extends JsonResource
{
    /** WCAG 2.1 AA for normal-size text. */
    private const AA_NORMAL_TEXT = 4.5;

    /** WCAG 2.1 AA for large text, logos and UI furniture. */
    private const AA_LARGE_TEXT = 3.0;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $trialEndsAt = $this->trial_ends_at;

        return [
            'id' => $this->id,
            'legal_name' => $this->legal_name,
            'trading_name' => $this->trading_name,

            // Reported, and flagged as fixed, so a console can render the field
            // as read-only rather than discovering the refusal on submit.
            'subdomain' => $this->subdomain,
            'subdomain_is_immutable' => true,

            'status' => $this->status->value,
            'trial_ends_at' => $trialEndsAt instanceof Carbon ? $trialEndsAt->toIso8601String() : null,

            'branding' => $this->branding(),

            'contact' => [
                'phone' => $this->contact_phone,
                'email' => $this->contact_email,
                'physical_address' => $this->physical_address,
                'district' => $this->district,
            ],

            'compliance' => [
                'umdpc_facility_reference' => $this->umdpc_facility_reference,
                'nda_licence_reference' => $this->nda_licence_reference,

                // Always false. See the class docblock.
                'verified_by_carevelo' => false,
                'attestation_note' => 'These references are recorded as this clinic\'s own attestation. '
                    .'Carevelo has no access to the UMDPC or NDA registers, has not checked them, and '
                    .'does not verify licences.',
            ],

            'timezone' => $this->timezone,
            'currency' => $this->currency,
        ];
    }

    /**
     * The complete branding token set.
     *
     * A closed, strictly typed list. There is no field here through which a
     * clinic can express CSS, markup or a font choice, and that absence is the
     * control -- free-form styling in a multi-tenant health application is an
     * exfiltration vector for special-category data, not a theming feature.
     *
     * @return array<string, mixed>
     */
    private function branding(): array
    {
        $primary = $this->hexOrNull($this->primary_colour);
        $secondary = $this->hexOrNull($this->secondary_colour);
        $logoPath = $this->logo_path;

        return [
            'primary_colour' => $primary,
            'primary_foreground' => self::readableForeground($primary),
            'secondary_colour' => $secondary,
            'secondary_foreground' => self::readableForeground($secondary),
            'logo_url' => is_string($logoPath) && $logoPath !== ''
                // Tenant-partitioned storage: one clinic's assets are not
                // reachable from another clinic's path prefix.
                ? Storage::disk('public')->url($logoPath)
                : null,
            'contrast_advisories' => self::contrastAdvisories($primary, $secondary),
        ];
    }

    /**
     * A stored value that is not a valid hex triplet is reported as absent.
     *
     * Belt and braces over the entry validation. The stored value ends up in a
     * CSS custom property, and "it was validated when it was written" is a
     * claim about history rather than about this string.
     */
    private function hexOrNull(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^#[0-9a-fA-F]{6}$/', $value) === 1 ? $value : null;
    }

    /**
     * Black or white, whichever the clinic's colour can actually carry.
     */
    private static function readableForeground(?string $hex): ?string
    {
        if ($hex === null) {
            return null;
        }

        return self::contrastRatio($hex, '#FFFFFF') >= self::contrastRatio($hex, '#111111')
            ? '#FFFFFF'
            : '#111111';
    }

    /**
     * Warnings the administrator sees while the choice is still cheap to change.
     *
     * Advisory rather than a validation failure: the portal stays readable
     * either way, because the foreground is computed. Refusing the colour
     * outright would be overreach -- it is the clinic's brand.
     *
     * @return list<string>
     */
    private static function contrastAdvisories(?string $primary, ?string $secondary): array
    {
        $advisories = [];

        foreach (['primary' => $primary, 'secondary' => $secondary] as $name => $hex) {
            if ($hex === null) {
                continue;
            }

            if (self::contrastRatio($hex, '#FFFFFF') < self::AA_LARGE_TEXT) {
                $advisories[] = sprintf(
                    'The %s colour is very pale against white. Patient-facing text will use a dark '
                    .'foreground so it stays readable; a deeper shade would carry the brand better.',
                    $name,
                );
            }
        }

        if ($primary !== null && $secondary !== null && self::contrastRatio($primary, $secondary) < self::AA_NORMAL_TEXT) {
            $advisories[] = 'The primary and secondary colours are close together, so the two will be hard '
                .'to tell apart on screen.';
        }

        return $advisories;
    }

    /**
     * WCAG 2.1 contrast ratio between two `#RRGGBB` values.
     */
    private static function contrastRatio(string $hex, string $other): float
    {
        $first = self::relativeLuminance($hex);
        $second = self::relativeLuminance($other);

        $lighter = max($first, $second);
        $darker = min($first, $second);

        return ($lighter + 0.05) / ($darker + 0.05);
    }

    /**
     * WCAG 2.1 relative luminance of a `#RRGGBB` value.
     */
    private static function relativeLuminance(string $hex): float
    {
        /** @var list<float> $channels */
        $channels = array_map(
            static function (string $pair): float {
                $channel = (float) hexdec($pair) / 255;

                return $channel <= 0.03928
                    ? $channel / 12.92
                    : (($channel + 0.055) / 1.055) ** 2.4;
            },
            str_split(substr($hex, 1), 2),
        );

        return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
    }
}
