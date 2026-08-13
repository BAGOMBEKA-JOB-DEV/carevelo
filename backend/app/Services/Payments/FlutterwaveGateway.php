<?php

namespace App\Services\Payments;

use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Flutterwave, which holds a Bank of Uganda Payment System Operator licence.
 *
 * The licensed party is the aggregator; the merchant is the clinic; Carevelo is
 * the software that calls their API on the clinic's behalf, with the clinic's
 * own key. Funds move patient -> aggregator -> clinic and never touch an
 * account we own, because no such account exists.
 *
 * Only one provider is implemented. Pesapal is named in the regulatory
 * documents and will need its own class -- deliberately not anticipated here,
 * because an interface generalised from a single example is a guess.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
final class FlutterwaveGateway implements PaymentGateway
{
    private const BASE_URL = 'https://api.flutterwave.com/v3';

    /** Short. A reconciliation sweep must not queue behind a hung aggregator. */
    private const TIMEOUT_SECONDS = 10;

    public function fetchStatus(AggregatorAccount $account, PaymentIntent $intent): GatewayStatus
    {
        if ($account->provider !== 'flutterwave') {
            throw new AggregatorUnavailable("No client is implemented for provider [{$account->provider}].");
        }

        $secret = $account->secret_key;

        if (! is_string($secret) || $secret === '') {
            throw new AggregatorUnavailable('The clinic has no usable aggregator credentials configured.');
        }

        try {
            $response = Http::withToken($secret)
                ->acceptJson()
                ->timeout(self::TIMEOUT_SECONDS)
                ->get(self::BASE_URL.'/transactions/verify_by_reference', [
                    'tx_ref' => $intent->reference,
                ]);
        } catch (Throwable $e) {
            // The original is deliberately NOT attached as `previous`. An HTTP
            // client exception carries the request, the request carries an
            // Authorization header, and that header is a clinic's merchant
            // credential -- which would then be written to any log that renders
            // the trace.
            throw new AggregatorUnavailable('Could not reach the aggregator: '.class_basename($e));
        }

        // Not seen yet. Common for a mobile-money push the patient has not
        // acted on, and not an error.
        if ($response->status() === 404) {
            return GatewayStatus::pending();
        }

        if (! $response->successful()) {
            throw new AggregatorUnavailable('The aggregator answered with HTTP '.$response->status().'.');
        }

        $data = $response->json('data');

        if (! is_array($data)) {
            throw new AggregatorUnavailable('The aggregator response could not be read.');
        }

        // An unrecognised status word is treated as "nothing yet" rather than
        // guessed at. The poll simply happens again; inventing an outcome would
        // confirm a booking nobody paid for.
        return AggregatorPayload::toGatewayStatus($data) ?? GatewayStatus::pending();
    }
}
