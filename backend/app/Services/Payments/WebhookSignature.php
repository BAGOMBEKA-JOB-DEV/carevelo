<?php

namespace App\Services\Payments;

use Illuminate\Http\Request;

/**
 * THE security boundary for the webhook endpoint.
 *
 * The endpoint is unauthenticated by nature -- the aggregator has no session
 * with us -- so trust comes entirely from this comparison. Everything ahead of
 * it, including the tenant named in the path, is untrusted input.
 *
 * @see docs/40-api/webhooks.md
 */
final class WebhookSignature
{
    /**
     * Header names carrying the signature.
     *
     * More than one because aggregators disagree: Flutterwave sends
     * `verif-hash`, others send a vendor-prefixed header. The name varies; the
     * comparison below does not.
     *
     * @var list<string>
     */
    public const HEADERS = ['X-Webhook-Signature', 'verif-hash'];

    public function fromRequest(Request $request): string
    {
        foreach (self::HEADERS as $header) {
            $value = $request->header($header);

            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return '';
    }

    /**
     * Verify a signature against the tenant's own webhook secret.
     *
     * $rawBody must be the bytes as received. Verifying a re-encoded payload
     * defeats the mechanism entirely: re-serialising JSON reorders keys and
     * changes whitespace, so the digest no longer covers what was sent.
     */
    public function verify(string $rawBody, string $provided, string $secret): bool
    {
        if ($provided === '' || $secret === '') {
            return false;
        }

        $expected = hash_hmac('sha256', $rawBody, $secret);

        // hash_equals, never ===. A timing side channel here leaks the digest
        // one byte at a time, and the prize is a forged payment confirmation.
        return hash_equals($expected, $provided);
    }
}
