<?php

namespace App\Http\Resources\V1;

use App\Models\Tenant;
use App\Support\Branding\BrandPalette;
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
     * The colour maths moved to App\Support\Branding\BrandPalette. It lived here as
     * private statics, which meant the patient-facing TenantResource -- the one
     * surface that absolutely must stay readable -- could not reach it, and returned
     * raw colours with no computed foreground at all.
     *
     * Advisories stay admin-only: they are guidance for whoever chose the colour, of
     * no use to a patient's browser.
     *
     * @return array<string, mixed>
     */
    private function branding(): array
    {
        $palette = BrandPalette::from($this->primary_colour, $this->secondary_colour);
        $logoPath = $this->logo_path;

        return [
            ...$palette->toTokens(),
            'logo_url' => is_string($logoPath) && $logoPath !== ''
                // Tenant-partitioned storage: one clinic's assets are not
                // reachable from another clinic's path prefix.
                ? Storage::disk('public')->url($logoPath)
                : null,
            'contrast_advisories' => $palette->advisories(),
        ];
    }
}
