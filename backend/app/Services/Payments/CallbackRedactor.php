<?php

namespace App\Services\Payments;

/**
 * Strips personal data from a callback before it is stored.
 *
 * The raw payload is kept against the intent so a dispute can be settled from
 * the record rather than from memory. That usefulness lasts years, and so does
 * the liability, so what is kept is the transaction -- references, amounts,
 * statuses -- and not the payer.
 *
 * Nothing clinical appears in a payment callback in the first place; this
 * guards the payer's contact details, which do.
 *
 * @see docs/30-architecture/observability.md
 */
final class CallbackRedactor
{
    /** Truncated to the last three digits: enough to recognise, not to dial. */
    private const TRUNCATE = ['phone', 'msisdn', 'mobile', 'account_number'];

    /** Removed outright: no dispute has ever turned on these. */
    private const DROP = ['email', 'name', 'address', 'card', 'auth', 'token', 'secret', 'key', 'pin'];

    /**
     * @param  array<array-key, mixed>  $payload
     * @return array<array-key, mixed>
     */
    public function redact(array $payload): array
    {
        $redacted = [];

        foreach ($payload as $key => $value) {
            $name = strtolower((string) $key);

            if ($this->matches($name, self::DROP)) {
                continue;
            }

            if (is_array($value)) {
                $redacted[$key] = $this->redact($value);

                continue;
            }

            $redacted[$key] = $this->matches($name, self::TRUNCATE)
                ? $this->truncate($value)
                : $value;
        }

        return $redacted;
    }

    /** @param  list<string>  $needles */
    private function matches(string $name, array $needles): bool
    {
        foreach ($needles as $needle) {
            if (str_contains($name, $needle)) {
                return true;
            }
        }

        return false;
    }

    private function truncate(mixed $value): string
    {
        $text = is_scalar($value) ? (string) $value : '';

        return '***'.substr($text, -3);
    }
}
