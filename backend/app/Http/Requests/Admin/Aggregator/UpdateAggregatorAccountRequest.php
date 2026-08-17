<?php

namespace App\Http\Requests\Admin\Aggregator;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The CLINIC'S OWN merchant credentials at a BoU-licensed aggregator.
 *
 * There is no platform merchant account. Carevelo has none, will never have
 * one, and could not use one without becoming a payment service provider under
 * the NPS Act 2020 -- so every credential in this payload belongs to the clinic
 * and every shilling collected with it settles directly to the clinic.
 *
 * PUT rather than PATCH, and `secret_key` is required: a partial credential
 * update produces a half-rotated key pair that fails at the aggregator hours
 * later, in production, on a live collection.
 *
 * Nothing validated here is ever returned. The response carries provider,
 * status, environment and the last verification time, and no endpoint anywhere
 * in this API reads a credential back.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 5
 */
class UpdateAggregatorAccountRequest extends FormRequest
{
    use RejectsUnknownFields;

    /**
     * Only Flutterwave is implemented. Pesapal is named in the regulatory
     * documents and is accepted here so a clinic can record the account it
     * actually holds; verification will refuse it until a client exists, which
     * is a truthful answer rather than a silent one.
     *
     * @var list<string>
     */
    public const PROVIDERS = ['flutterwave', 'pesapal'];

    /** @var list<string> */
    public const ENVIRONMENTS = ['sandbox', 'live'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'provider' => ['required', 'string', Rule::in(self::PROVIDERS)],
            'environment' => ['required', 'string', Rule::in(self::ENVIRONMENTS)],

            'public_key' => ['sometimes', 'nullable', 'string', 'max:255'],
            'secret_key' => ['required', 'string', 'min:8', 'max:255'],
            'webhook_secret' => ['sometimes', 'nullable', 'string', 'max:255'],

            // The clinic's own reference at the aggregator, used so it can match
            // a collection to a line on its own dashboard unaided.
            'merchant_reference' => ['sometimes', 'nullable', 'string', 'max:64'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'provider.in' => 'Carevelo connects to '.implode(' or ', self::PROVIDERS)
                .'. The account must be the clinic\'s own.',
            'secret_key.required' => 'Enter the clinic\'s own secret key. Credentials are replaced as a set, '
                .'never one field at a time.',
        ];
    }
}
