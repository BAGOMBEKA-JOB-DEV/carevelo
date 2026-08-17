<?php

namespace App\Http\Requests\Admin\Services;

/**
 * Adds a service to the clinic's own catalogue.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 */
class StoreServiceRequest extends ServiceRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // A new service must arrive with a name, a length and a price. There is
        // no default price: an unpriced service published to patients becomes a
        // dispute at the front desk.
        return $this->serviceRules(['required']);
    }
}
