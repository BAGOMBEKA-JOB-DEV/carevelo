<?php

namespace App\Http\Requests\Admin\Services;

/**
 * Amends a service the clinic already offers.
 *
 * Every field is optional, so a price change is a request carrying only
 * `price_minor`. Unknown fields are still rejected -- a mistyped `price_minor`
 * that validated as "nothing to change" is how a clinic discovers weeks later
 * that it has been charging the old amount.
 */
class UpdateServiceRequest extends ServiceRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return $this->serviceRules(['sometimes', 'required']);
    }
}
