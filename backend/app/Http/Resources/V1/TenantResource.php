<?php

namespace App\Http\Resources\V1;

use App\Models\Tenant;
use App\Support\Branding\BrandPalette;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The clinic's public-facing identity: branding and contact details.
 *
 * Deliberately excludes the compliance references (UMDPC, NDA). Those are the
 * clinic's own unverified attestation, and exposing them on a patient-facing
 * endpoint would imply Carevelo had checked them. We have no access to those
 * registers and must never suggest otherwise.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 *
 * @mixin Tenant
 */
class TenantResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'trading_name' => $this->trading_name ?? $this->legal_name,
            /*
             * The RESOLVED token set, not the raw colours.
             *
             * This endpoint feeds the patient portal, which is the surface that has
             * to stay readable — and until now it returned primary_colour and
             * secondary_colour with no foreground, so the client would have had to
             * compute contrast itself. That contradicts the rule that branding
             * tokens are "validated server-side before reaching the client" and
             * "arrive as a strict, typed set", and it would have meant two
             * implementations of the same WCAG maths, free to disagree.
             *
             * Advisories are deliberately absent: they are guidance for the
             * administrator who chose the colour.
             *
             * @see docs/10-product/white-labeling-and-branding.md
             */
            'branding' => [
                ...BrandPalette::from($this->primary_colour, $this->secondary_colour)->toTokens(),
                'logo_url' => $this->logo_path,
            ],
            'contact' => [
                'phone' => $this->contact_phone,
                'email' => $this->contact_email,
                'physical_address' => $this->physical_address,
                'district' => $this->district,
            ],
            'timezone' => $this->timezone,
            'currency' => $this->currency,
        ];
    }
}
