<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\PaymentIntent;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * The aggregator reported that a payment attempt succeeded.
 *
 * A HINT, and here the distinction is not academic: a client must never treat
 * a frame as confirmation that a patient paid. Frames are dropped, duplicated
 * and replayed; the intent's state is read back from the API, which reconciles
 * independently of any webhook.
 *
 * NO AMOUNT ON THE WIRE. The identifier and the state are enough to trigger a
 * re-fetch, and Carevelo holds no funds to report on in the first place.
 *
 * Routing identifiers are optional because a payment intent is polymorphic:
 * the caller knows which patient and which staff member were waiting on it.
 */
final class PaymentIntentSucceeded extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $paymentIntentId,
        public readonly string $reference,
        public readonly string $status,
        public readonly ?string $patientId = null,
        public readonly ?string $userId = null,
    ) {
        parent::__construct($tenantId);
    }

    public static function from(PaymentIntent $intent, ?string $patientId = null, ?string $userId = null): self
    {
        return new self(
            self::tenantOf($intent),
            self::keyOf($intent),
            self::stringAttribute($intent, 'reference'),
            $intent->status->value,
            $patientId,
            $userId,
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        $channels = [];

        if ($this->patientId !== null) {
            $channels[] = TenantChannel::patient($this->tenantId, $this->patientId);
        }

        if ($this->userId !== null) {
            $channels[] = TenantChannel::user($this->tenantId, $this->userId);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'payment_intent.succeeded';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'payment_intent_id' => $this->paymentIntentId,
            'reference' => $this->reference,
            'status' => $this->status,
        ];
    }
}
