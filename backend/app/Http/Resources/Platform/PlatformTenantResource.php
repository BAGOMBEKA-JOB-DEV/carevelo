<?php

namespace App\Http\Resources\Platform;

use App\Models\Tenant;
use App\Models\TenantStatus;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * A clinic as the platform sees it: a register entry and a subscription state.
 *
 * Read the list below for what is NOT on it. No patient count, no consultation
 * count, no prescription volume — not even as a number. Platform roles reach
 * tenant administration and no clinical data, and an aggregate is still an
 * observation about a clinic's patients.
 *
 * No aggregator credentials either, in any form. They are unreadable by every
 * role including this one.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 *
 * @mixin Tenant
 */
class PlatformTenantResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $trialEndsAt = $this->trial_ends_at;

        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'subdomain' => $this->subdomain,
            'custom_domain' => $this->custom_domain,
            'legal_name' => $this->legal_name,
            'trading_name' => $this->trading_name,
            'district' => $this->district,

            /*
             * The commercial state, and the only lever the platform holds.
             *
             * `suspended` here means staff sign-in is blocked. It does not mean
             * the clinic's patients lose access to their own records, and it
             * never means an export can be withheld.
             */
            'status' => $this->status->value,
            'is_suspended' => $this->status === TenantStatus::Suspended,
            'trial_ends_at' => $trialEndsAt instanceof Carbon ? $trialEndsAt->toIso8601String() : null,

            /*
             * The clinic's own unverified attestation, shown to support because
             * support fields questions about it. Carevelo has no access to the
             * UMDPC or NDA registers and must never present these as checked.
             */
            'attestations' => [
                'umdpc_facility_reference' => $this->umdpc_facility_reference,
                'nda_licence_reference' => $this->nda_licence_reference,
                'verified_by_carevelo' => false,
            ],

            'contact' => [
                'phone' => $this->contact_phone,
                'email' => $this->contact_email,
            ],

            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
