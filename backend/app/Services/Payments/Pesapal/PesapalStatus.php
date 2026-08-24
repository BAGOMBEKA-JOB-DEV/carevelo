<?php

namespace App\Services\Payments\Pesapal;

use App\Services\Payments\AggregatorPayload;
use App\Services\Payments\GatewayStatus;

/**
 * Pesapal's four status codes, and nothing else.
 *
 * Pesapal reports an outcome as an INTEGER rather than a word, which removes
 * the whole class of near-miss vocabulary the Flutterwave mapping has to cope
 * with -- and replaces it with a sharper hazard, because 0 and 1 both look
 * perfectly reasonable and mean opposite things. They are named here rather
 * than inlined so that reading the mapping does not require the documentation
 * open beside it.
 *
 * The discipline is AggregatorCallback::fromPayload()'s: an unrecognised code
 * returns null and is never guessed. The failure modes are asymmetric -- a code
 * misread as success confirms a booking nobody paid for -- and Pesapal is free
 * to add a fifth code tomorrow without telling us.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
final class PesapalStatus
{
    /**
     * Pesapal has nothing for this order.
     *
     * Not an error, and emphatically not a failure. It is the ordinary answer
     * while a patient has the mobile-money prompt on screen and has not yet
     * typed a PIN -- which in this market is most of the time a payment exists.
     */
    public const INVALID = 0;

    public const COMPLETED = 1;

    public const FAILED = 2;

    /** Rare, and always human-handled once recorded. */
    public const REVERSED = 3;

    /**
     * Read a GetTransactionStatus body.
     *
     * Returns null for anything unreadable so the caller can refuse rather than
     * approximate.
     *
     * @param  array<array-key, mixed>  $body
     */
    public static function toGatewayStatus(array $body): ?GatewayStatus
    {
        $code = self::code($body['status_code'] ?? null);

        if ($code === null) {
            return null;
        }

        // What Pesapal SAYS was collected, in major units. Carried only so the
        // resolver can compare it against the stored intent and refuse a
        // mismatch; it is never believed on its own.
        $amountMinor = AggregatorPayload::minorUnits($body['amount'] ?? null);

        $reference = AggregatorPayload::string($body['confirmation_code'] ?? null);

        return match ($code) {
            self::COMPLETED => GatewayStatus::succeeded($amountMinor, $reference),
            self::REVERSED => GatewayStatus::reversed($amountMinor, $reference),
            self::FAILED => GatewayStatus::failed(
                AggregatorPayload::string(self::error($body)['code'] ?? null),
                // Surfaced verbatim: only Pesapal knows why a mobile-money
                // collection failed, and paraphrasing loses the part the patient
                // can act on. The body reaching here has already had the
                // clinic's credentials stripped out of it by PesapalClient.
                AggregatorPayload::string(
                    self::error($body)['message'] ?? $body['payment_status_description'] ?? null
                ),
            ),
            default => GatewayStatus::pending(),
        };
    }

    /**
     * The status code, if it is one of the four we know.
     *
     * A JSON number or a numeric string -- Pesapal has sent both -- and nothing
     * else. `true`, `1.5`, `"one"` and a missing key all return null, which the
     * caller turns into "ask again", not into an outcome.
     */
    private static function code(mixed $raw): ?int
    {
        $code = match (true) {
            is_int($raw) => $raw,
            is_string($raw) && preg_match('/^\d+$/', $raw) === 1 => (int) $raw,
            default => null,
        };

        return in_array($code, [self::INVALID, self::COMPLETED, self::FAILED, self::REVERSED], true)
            ? $code
            : null;
    }

    /**
     * @param  array<array-key, mixed>  $body
     * @return array<array-key, mixed>
     */
    private static function error(array $body): array
    {
        return is_array($body['error'] ?? null) ? $body['error'] : [];
    }
}
