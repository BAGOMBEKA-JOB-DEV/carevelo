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
            /*
             * The aggregator's hosted payment page, where one exists.
             *
             * Present only for a provider that is initiated server-side --
             * Pesapal today. Null is the ordinary answer for Flutterwave, whose
             * collection the client starts itself, and for cash at the clinic,
             * where nobody is going anywhere.
             *
             * It is a place to send the patient, NOT a confirmation of
             * anything. A client that treats the presence of this URL as a paid
             * booking has confirmed a booking nobody has paid for: the intent
             * is `initiated` at this point, and only the aggregator can say
             * what happens next.
             */
            'redirect_url' => $this->redirect_url,
            // Surfaced verbatim: only the aggregator knows why a collection
            // failed, and paraphrasing loses the actionable part.
            'failure_message' => $this->failure_message,
            'initiated_at' => $this->initiated_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
        ];
    }
}
