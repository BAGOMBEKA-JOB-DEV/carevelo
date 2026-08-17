<?php

namespace App\Http\Resources\V1;

use App\Models\PaymentIntent;
use App\Models\Tenant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A receipt for money THE CLINIC RECEIVED.
 *
 * The payee is the clinic and there is no second party on this document. The
 * patient paid the clinic's own merchant account at a BoU-licensed aggregator,
 * using the clinic's own credentials, and the funds settled to the clinic
 * direct. Naming this platform anywhere in a payee role would be a false
 * statement on a financial document and, worse, a claim of custody -- which
 * would place us in the NPS Act 2020 PSP category we are built to stay out of.
 *
 * That is also why the note tells the patient to take any query, refunds
 * included, to the clinic: the clinic is the only party that holds anything to
 * refund from.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 *
 * @mixin PaymentIntent
 */
class ReceiptResource extends JsonResource
{
    public function __construct(PaymentIntent $resource, private readonly Tenant $payee)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $payeeName = $this->payeeName();

        return [
            'reference' => $this->reference,
            'payee' => [
                'name' => $payeeName,
                'legal_name' => $this->payee->legal_name,
                'district' => $this->payeeText('district'),
                'physical_address' => $this->payeeText('physical_address'),
                'contact_phone' => $this->payeeText('contact_phone'),
                'contact_email' => $this->payeeText('contact_email'),
            ],
            'amount' => $this->amount,
            'method' => $this->method->value,
            // The line the patient and the clinic can both quote. It is the
            // aggregator's own reference because the aggregator is the party
            // that actually moved the money.
            'aggregator_reference' => $this->aggregator_reference,
            'paid_at' => $this->resolved_at?->toIso8601String(),
            'payable' => [
                'type' => $this->getAttribute('payable_type'),
                'id' => $this->getAttribute('payable_id'),
            ],
            'note' => sprintf(
                'This payment was made to and received by %s. Take any question about it, '
                .'including any refund, to the clinic.',
                $payeeName,
            ),
        ];
    }

    /**
     * The name the patient will recognise: the trading name, or the registered
     * one where a clinic has only that.
     */
    private function payeeName(): string
    {
        return $this->payeeText('trading_name') ?? $this->payee->legal_name;
    }

    private function payeeText(string $key): ?string
    {
        $value = $this->payee->getAttribute($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
