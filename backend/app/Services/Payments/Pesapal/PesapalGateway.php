<?php

namespace App\Services\Payments\Pesapal;

use App\Models\AggregatorAccount;
use App\Models\Patient;
use App\Models\PaymentIntent;
use App\Services\Payments\AggregatorPayload;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\CollectionHandoff;
use App\Services\Payments\GatewayStatus;
use App\Services\Payments\PaymentGateway;

/**
 * Pesapal, which holds a Bank of Uganda Payment System Operator licence.
 *
 * The merchant account is the CLINIC'S OWN -- one Pesapal account per clinic,
 * chosen so that ADR-0003 survives a second aggregator intact. The patient pays
 * Pesapal, Pesapal settles to the clinic, and Carevelo is the software that
 * introduced them. There is no platform merchant account here or anywhere,
 * because custody would put us inside the NPS Act 2020 PSP and e-money
 * categories at UGX 250m-10bn of capital.
 *
 * WHAT MAKES PESAPAL DIFFERENT FROM FLUTTERWAVE, and why the port had to widen:
 * Flutterwave's collection is started by the client and read back by us.
 * Pesapal's is started by us -- SubmitOrderRequest -- and the patient is then
 * sent to Pesapal's own page. That handoff is the whole of the difference, and
 * it still moves no money: it tells the clinic's aggregator that a collection
 * is expected and returns a URL.
 *
 * This class holds the DOMAIN decisions. PesapalClient holds the HTTP, the
 * credentials and the token. The split is not ceremony: the rules about what we
 * are willing to send an aggregator about a patient, and what a minor unit
 * means, are the parts a reviewer needs to be able to find.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
final class PesapalGateway implements PaymentGateway
{
    /** Pesapal accepts alphanumerics plus these four, up to fifty characters. */
    private const MERCHANT_REFERENCE_PATTERN = '/^[A-Za-z0-9\-_.:]{1,50}$/';

    /** Pesapal truncates beyond this; we would rather choose where. */
    private const DESCRIPTION_MAX = 100;

    public function __construct(private readonly PesapalClient $client) {}

    /**
     * Ask Pesapal what became of a collection.
     *
     * Two paths, and the second one is what makes credential verification
     * possible.
     *
     * An intent Pesapal has been told about carries its tracking id, and the
     * answer comes from GetTransactionStatus.
     *
     * An intent with NO tracking id was never submitted -- the probe the verify
     * endpoint builds, or an attempt whose handoff failed. Pesapal has nothing
     * to say about an order it has never seen, so the truthful answer is
     * `pending`. The call is still worth making: requesting a token exercises
     * exactly what verification needs to exercise, which is whether Pesapal
     * accepts THIS CLINIC'S credentials, and it moves no money at all. It is
     * the same trick FlutterwaveGateway plays by reading a reference that does
     * not exist.
     */
    public function fetchStatus(AggregatorAccount $account, PaymentIntent $intent): GatewayStatus
    {
        $this->assertPesapal($account);

        $trackingId = $intent->getAttribute('aggregator_tracking_id');

        if (! is_string($trackingId) || $trackingId === '') {
            $this->client->assertCredentialsWork($account);

            return GatewayStatus::pending();
        }

        return $this->client->transactionStatus($account, $trackingId);
    }

    /**
     * Submit the order and hand back where the patient pays.
     *
     * Nothing is persisted here on purpose -- see the port. The caller stores
     * the tracking id, and it must, because an inbound Pesapal notification
     * carries that id and nothing else.
     */
    public function initiateCollection(AggregatorAccount $account, PaymentIntent $intent): CollectionHandoff
    {
        $this->assertPesapal($account);

        $reference = (string) $intent->reference;

        if (preg_match(self::MERCHANT_REFERENCE_PATTERN, $reference) !== 1) {
            // Cannot happen with references this system generates, and that is
            // why it is checked. A reference Pesapal rejects would surface as
            // an opaque aggregator error on a patient's first payment.
            throw new AggregatorUnavailable('Our own reference is not in a shape the aggregator accepts.');
        }

        return $this->client->submitOrder($account, [
            'id' => $reference,
            'currency' => (string) $intent->getAttribute('currency'),
            'amount' => $this->amount($intent),
            'description' => $this->description($reference),
            'callback_url' => $this->callbackUrl(),
            'notification_id' => $this->notificationId($account),
            'billing_address' => $this->billingAddress($intent),
        ]);
    }

    /**
     * The amount, in major units, without ever touching a float.
     *
     * A minor unit in this system is one HUNDREDTH OF A SHILLING. That is not
     * self-evident: Currency::UGX::hasSubunitInPractice() is false because
     * nobody in Uganda quotes cents. The factor comes from MoneyCast, which
     * stores `amount_minor` beside a currency, and from Money::ugx(), which
     * multiplies whole shillings by a hundred. A UGX 30,000 consultation --
     * PaymentIntentFactory's realistic fee -- is 3,000,000 in the column and
     * 30,000 on the wire. A conversion wrong by that factor would bill a
     * patient a hundred times the fee, AND WOULD PASS THE FRAUD BOUNDARY,
     * because the amount Pesapal reported back would agree with the amount we
     * asked for.
     *
     * The shape sent is an integer when the amount is a whole number of
     * shillings, which for UGX it always is. A JSON integer is exact in every
     * decoder that will ever read it.
     *
     * The other branch is the interesting one. A fractional shilling has no
     * exact representation as a JSON number that PHP can emit -- json_encode
     * would hand Pesapal an IEEE-754 double, which is precisely the defect
     * Money exists to prevent -- so it goes as the decimal STRING produced by
     * AggregatorPayload::majorUnits(), which is lossless. It costs nothing, it
     * is never reached in practice, and it means there is no input to this
     * method for which a rounding error is possible.
     */
    private function amount(PaymentIntent $intent): int|string
    {
        $amountMinor = (int) $intent->getAttribute('amount_minor');

        // Refuses a negative amount outright, and is the tested inverse of the
        // inbound conversion.
        $decimal = AggregatorPayload::majorUnits($amountMinor);

        return $amountMinor % 100 === 0
            ? intdiv($amountMinor, 100)
            : $decimal;
    }

    /**
     * What Pesapal shows the patient, and prints on its own statements.
     *
     * OUR REFERENCE AND NOTHING ELSE. No service name, no clinician, no reason
     * for the visit. A payment description is rendered on a Pesapal receipt, an
     * SMS from the mobile-money operator and a bank statement -- three places
     * outside this system's control, read by whoever holds the handset. That a
     * person paid a clinic is unavoidable; what they paid it for is not ours to
     * broadcast.
     */
    private function description(string $reference): string
    {
        return mb_substr('Carevelo payment '.$reference, 0, self::DESCRIPTION_MAX);
    }

    /**
     * Where Pesapal returns the PATIENT'S BROWSER after the hosted page.
     *
     * Not a trust boundary and not a resolution path: Pesapal appends its own
     * query parameters to this URL, and the portal it lands on reads the intent
     * back through the authorised API rather than believing them. The payment
     * is resolved by the IPN and by reconciliation, both of which read status
     * from Pesapal directly.
     */
    private function callbackUrl(): string
    {
        $configured = config('services.pesapal.callback_url');

        if (is_string($configured) && $configured !== '') {
            return $configured;
        }

        return rtrim((string) config('app.url'), '/').'/payments/return';
    }

    /**
     * The clinic's registered notification id, registering one if it has none.
     *
     * Stored on the account rather than resolved per payment. RegisterIPN is
     * not idempotent, so a clinic that registered on every collection would
     * accumulate registrations and receive a notification per registration --
     * and PesapalClient consults GetIpnList first precisely so a lost column
     * value cannot cause that either.
     *
     * The URL is derived from the route, not configured, so it cannot drift
     * from the endpoint that actually exists.
     */
    private function notificationId(AggregatorAccount $account): string
    {
        $stored = $account->getAttribute('ipn_id');

        if (is_string($stored) && $stored !== '') {
            return $stored;
        }

        $id = $this->client->ipnIdFor(
            $account,
            route('webhooks.pesapal', ['tenant' => $account->getAttribute('tenant_id')]),
        );

        $account->forceFill(['ipn_id' => $id])->save();

        return $id;
    }

    /**
     * How Pesapal reaches the person paying.
     *
     * Pesapal needs a contact to push a mobile-money prompt to and a name to
     * put on its own record of the transaction; the clinic is the merchant, and
     * this is the merchant's customer. Every field here is contact detail.
     *
     * NOTHING CLINICAL LEAVES WITH IT. Not the service, not the clinician, not
     * the appointment. An aggregator learns that someone paid a clinic, which
     * it cannot avoid learning, and nothing whatever about why.
     *
     * A patient we cannot resolve -- a payable type no longer owned, a record
     * outside this session's row-level security -- yields nulls rather than an
     * error. Pesapal requires one contact field and will refuse the order
     * itself if it has none, which is a better failure than a 500 here.
     *
     * @return array<string, ?string>
     */
    private function billingAddress(PaymentIntent $intent): array
    {
        $patient = $this->payer($intent);

        return [
            'email_address' => $this->stringOrNull($patient?->getAttribute('email')),
            'phone_number' => $this->stringOrNull($patient?->getAttribute('phone')),
            'country_code' => 'UG',
            'first_name' => $this->stringOrNull($patient?->getAttribute('given_name')),
            'last_name' => $this->stringOrNull($patient?->getAttribute('family_name')),
        ];
    }

    /**
     * The patient behind the thing being paid for.
     *
     * Resolved through PaymentIntent::patientId(), which is already the one
     * place that knows how a payable maps to a patient, and which is itself
     * row-level-security scoped.
     */
    private function payer(PaymentIntent $intent): ?Patient
    {
        $patientId = $intent->patientId();

        return $patientId === null
            ? null
            : Patient::query()->whereKey($patientId)->first();
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * The same honest refusal FlutterwaveGateway gives.
     *
     * A client reached with another provider's account would authenticate a
     * clinic's Flutterwave key against Pesapal, which is both certain to fail
     * and a credential sent to a party that has no business seeing it.
     */
    private function assertPesapal(AggregatorAccount $account): void
    {
        if ($account->provider !== 'pesapal') {
            throw new AggregatorUnavailable("No client is implemented for provider [{$account->provider}].");
        }
    }
}
