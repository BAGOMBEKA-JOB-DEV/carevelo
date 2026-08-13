<?php

namespace App\Http\Resources\V1;

use App\Models\Tenant;
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
            'branding' => [
                'primary_colour' => $this->primary_colour,
                'secondary_colour' => $this->secondary_colour,
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
