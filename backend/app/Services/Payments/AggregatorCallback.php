<?php

namespace App\Services\Payments;

/**
 * A parsed inbound callback.
 *
 * Everything in here came off the wire and is untrusted, including -- above
 * all -- the amount. It is carried so it can be COMPARED against the stored
 * intent, never so it can be believed.
 *
 * @see docs/40-api/webhooks.md
 */
final readonly class AggregatorCallback
{
    private function __construct(
        /** The aggregator's own id for this delivery. The idempotency key. */
        public string $eventId,
        /** Our merchant reference, echoed back. */
        public string $reference,
        public GatewayStatus $reported,
    ) {}

    /**
     * Read a callback body.
     *
     * Returns null for anything unreadable rather than throwing, so the caller
     * answers 400 without the endpoint ever producing a stack trace -- the
     * endpoint is public and its responses are a disclosure surface.
     *
     * @param  array<array-key, mixed>  $payload
     */
    public static function fromPayload(array $payload): ?self
    {
        // Aggregators wrap the transaction in a `data` envelope; some do not.
        $data = is_array($payload['data'] ?? null) ? $payload['data'] : $payload;

        $eventId = AggregatorPayload::string(
            $payload['event_id'] ?? $data['event_id'] ?? $data['id'] ?? null
        );

        $reference = AggregatorPayload::string(
            $data['tx_ref'] ?? $data['reference'] ?? $data['merchant_reference'] ?? null
        );

        if ($eventId === null || $reference === null) {
            return null;
        }

        $reported = AggregatorPayload::toGatewayStatus($data);

        // Fall back to the envelope's event name -- `charge.completed` and
        // friends -- but ONLY when the transaction object carries no status of
        // its own. An explicit status we do not recognise is a payload we
        // refuse to read, not one to second-guess from the envelope: the
        // failure modes are asymmetric, and guessing confirms a booking nobody
        // paid for.
        if ($reported === null && ! isset($data['status'])) {
            $reported = AggregatorPayload::toGatewayStatus(
                array_merge($data, ['status' => $payload['event'] ?? null])
            );
        }

        if ($reported === null) {
            return null;
        }

        return new self($eventId, $reference, $reported);
    }
}
