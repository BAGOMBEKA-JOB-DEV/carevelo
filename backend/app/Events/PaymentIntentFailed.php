<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\PaymentIntent;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * The aggregator reported that a payment attempt failed.
 *
 * Failure is not always final — a timed-out mobile-money collection can still
 * confirm late — so this frame moves a screen off "waiting", never a record
 * into a terminal state. The record moves when the API says so.
 *
 * `failure_message` is deliberately absent: it is aggregator-supplied text
 * that reaches several subscribers at once, and no operational decision needs
 * it on the wire.
 */
final class PaymentIntentFailed extends TenantBroadcast
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
        return 'payment_intent.failed';
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
