<?php

namespace App\Services\Payments;

use App\Models\PaymentIntentStatus;

/**
 * What an aggregator says became of a collection.
 *
 * The same shape whether it arrived as an inbound webhook or as the answer to a
 * reconciliation poll, because the two paths race and the loser must be a
 * harmless no-op. One shape means one code path applies it, so the fraud
 * boundary -- validating the reported amount against the stored intent -- is
 * enforced in one place rather than twice with a drift between them.
 *
 * @see docs/40-api/webhooks.md
 */
final readonly class GatewayStatus
{
    private function __construct(
        public PaymentIntentStatus $status,
        /**
         * What the aggregator SAYS was collected. Never authoritative: it is
         * compared against the stored intent and discarded on a mismatch.
         */
        public ?int $amountMinor = null,
        public ?string $aggregatorReference = null,
        public ?string $failureCode = null,
        public ?string $failureMessage = null,
    ) {}

    /** Nothing has happened yet. The normal answer for mobile money. */
    public static function pending(): self
    {
        return new self(PaymentIntentStatus::Pending);
    }

    public static function succeeded(?int $amountMinor, ?string $aggregatorReference = null): self
    {
        return new self(PaymentIntentStatus::Succeeded, $amountMinor, $aggregatorReference);
    }

    public static function failed(?string $code = null, ?string $message = null): self
    {
        return new self(
            PaymentIntentStatus::Failed,
            failureCode: $code,
            failureMessage: $message,
        );
    }

    /** Rare, and always human-handled once recorded. */
    public static function reversed(?int $amountMinor, ?string $aggregatorReference = null): self
    {
        return new self(PaymentIntentStatus::Reversed, $amountMinor, $aggregatorReference);
    }

    /**
     * Whether this report claims money actually moved.
     *
     * Only these carry an amount worth checking. A failure report has no amount
     * to validate, and demanding one would reject legitimate callbacks.
     */
    public function assertsMoneyMoved(): bool
    {
        return in_array(
            $this->status,
            [PaymentIntentStatus::Succeeded, PaymentIntentStatus::Reversed],
            true,
        );
    }
}
