<?php

namespace App\Http\Resources\V1;

use App\Models\PaymentIntent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A record of a payment attempt.
 *
 * Note what is absent: no balance, no settled amount, no platform account.
 * Carevelo cannot see what settled -- only what the aggregator reported.
 *
 * @mixin PaymentIntent
 */
class PaymentIntentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // Sent to the aggregator as merchant_reference, so the clinic can
            // match this to a line on its own dashboard unaided.
            'reference' => $this->reference,
            'status' => $this->status->value,
            'amount' => $this->amount,
            'method' => $this->method->value,
            'aggregator_reference' => $this->aggregator_reference,
            // Surfaced verbatim: only the aggregator knows why a collection
            // failed, and paraphrasing loses the actionable part.
            'failure_message' => $this->failure_message,
            'initiated_at' => $this->initiated_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
        ];
    }
}
