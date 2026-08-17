<?php

namespace App\Http\Resources\Platform;

use App\Models\BreakGlassGrant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One grant, as both audiences need to see it.
 *
 * The reason is shown in full. It is the operator's own words, it is what makes
 * the grant reviewable, and the clinic named in it is entitled to read it —
 * withholding the reason from the controller would reduce the notification to a
 * bare "we looked at something".
 *
 * `permits_access_now` is computed rather than stored. A time box that has
 * elapsed must read as closed on the next request, not on the next time
 * something remembers to sweep the table.
 *
 * @mixin BreakGlassGrant
 */
class BreakGlassGrantResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'operator_id' => $this->operator_id,
            'reason' => $this->reason,
            'scope' => $this->scope,

            'granted_at' => $this->granted_at->toIso8601String(),
            'expires_at' => $this->expires_at->toIso8601String(),
            'revoked_at' => $this->revoked_at?->toIso8601String(),

            // Not decoration. An unnotified grant permits nothing, so this field
            // is the difference between a request and a grant.
            'tenant_notified_at' => $this->tenant_notified_at?->toIso8601String(),

            'has_expired' => $this->hasExpired(),
            'permits_access_now' => $this->permits($this->scope),
        ];
    }
}
