<?php

namespace App\Services\Payments;

use App\Models\PaymentIntentStatus;

/**
 * Reads the two fields every aggregator expresses differently: status and amount.
 *
 * Shared by the webhook parser and the reconciliation poll because they read
 * the same provider's vocabulary from two directions. Keeping the mapping in
 * one place means a status word cannot mean "succeeded" on one path and
 * "pending" on the other.
 */
final class AggregatorPayload
{
    /**
     * Map an aggregator's status word onto our own vocabulary.
     *
     * Unrecognised words return null rather than a guess. Guessing here would
     * mean inventing a payment outcome, and the failure modes are asymmetric:
     * treating an unknown word as success confirms a booking nobody paid for.
     */
    public static function status(mixed $raw): ?PaymentIntentStatus
    {
        if (! is_string($raw)) {
            return null;
        }

        return match (strtolower(trim($raw))) {
            'successful', 'success', 'succeeded', 'completed', 'charge.completed' => PaymentIntentStatus::Succeeded,
            'failed', 'failure', 'error', 'cancelled', 'canceled', 'declined' => PaymentIntentStatus::Failed,
            'pending', 'processing', 'initiated', 'ongoing' => PaymentIntentStatus::Pending,
            'reversed', 'refunded', 'chargeback', 'voided' => PaymentIntentStatus::Reversed,
            default => null,
        };
    }

    /**
     * Convert a major-unit amount into integer minor units.
     *
     * Deliberately via a decimal string rather than arithmetic on a binary
     * fraction: an IEEE-754 round trip on a money amount is exactly the defect
     * the Money value object exists to prevent, and this is the one place a
     * foreign amount enters the system.
     */
    public static function minorUnits(mixed $raw): ?int
    {
        if (! is_numeric($raw)) {
            return null;
        }

        $normalised = sprintf('%.2F', $raw);

        if (str_starts_with($normalised, '-')) {
            // A negative collection is not a reversal, it is a malformed
            // payload. Reversals arrive as a status, never as a sign.
            return null;
        }

        [$whole, $fraction] = explode('.', $normalised);

        return ((int) $whole) * 100 + ((int) $fraction);
    }

    /**
     * Build a report from an aggregator's transaction object.
     *
     * @param  array<array-key, mixed>  $data
     */
    public static function toGatewayStatus(array $data): ?GatewayStatus
    {
        $status = self::status($data['status'] ?? null);

        if ($status === null) {
            return null;
        }

        $amountMinor = self::minorUnits($data['amount_minor'] ?? null)
            ?? self::minorUnits($data['amount'] ?? null);

        $reference = self::string($data['flw_ref'] ?? $data['transaction_id'] ?? $data['id'] ?? null);

        return match ($status) {
            PaymentIntentStatus::Succeeded => GatewayStatus::succeeded($amountMinor, $reference),
            PaymentIntentStatus::Reversed => GatewayStatus::reversed($amountMinor, $reference),
            PaymentIntentStatus::Failed => GatewayStatus::failed(
                self::string($data['failure_code'] ?? $data['processor_response'] ?? null),
                // Surfaced verbatim: only the aggregator knows why a
                // mobile-money collection failed, and paraphrasing loses the
                // part the patient can act on.
                self::string($data['failure_message'] ?? $data['narration'] ?? null),
            ),
            default => GatewayStatus::pending(),
        };
    }

    /** Aggregators send numeric identifiers as often as strings. */
    public static function string(mixed $value): ?string
    {
        if (is_string($value)) {
            return $value === '' ? null : $value;
        }

        return is_int($value) ? (string) $value : null;
    }
}
