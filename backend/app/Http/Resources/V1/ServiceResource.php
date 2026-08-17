<?php

namespace App\Http\Resources\V1;

use App\Models\Service;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * A bookable offering, priced by the clinic that offers it.
 *
 * The price is serialised as `{amount_minor, currency}` -- an integer and an
 * explicit currency, never a decimal string a client might parse into a float.
 * Carevelo publishes no price list of its own and takes no margin: every figure
 * here is the clinic's own.
 *
 * `is_active` is published rather than hidden because deactivation is how a
 * service is retired. Historical appointments still point at the row, so a
 * client showing a past booking needs to be able to say "no longer offered"
 * instead of failing to resolve the reference.
 *
 * @mixin Service
 *
 * @property-read ?string $description
 * @property-read int $duration_minutes
 * @property-read ?list<string> $modes
 * @property-read ?list<string> $eligible_roles
 * @property-read ?Carbon $created_at
 * @property-read ?Carbon $updated_at
 */
class ServiceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'duration_minutes' => $this->duration_minutes,
            // `price_minor` is NOT NULL with a zero default, so there is always
            // an amount to publish -- a service with no price is priced at zero,
            // which is a decision the clinic can legitimately make.
            'price' => $this->price->jsonSerialize(),
            // Voice and chat are first-class choices, not fallbacks, so the
            // client needs the full list to offer them as equals.
            'modes' => $this->modes ?? [],
            'eligible_roles' => $this->eligible_roles ?? [],
            'is_active' => $this->is_active,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
