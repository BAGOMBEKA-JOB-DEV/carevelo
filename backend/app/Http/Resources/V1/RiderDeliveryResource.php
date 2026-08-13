<?php

namespace App\Http\Resources\V1;

use App\Models\Delivery;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A delivery, as a RIDER sees it.
 *
 * THIS IS A DISTINCT RESOURCE CLASS WITH NO CLINICAL FIELDS -- not the
 * dispatcher resource with fields hidden in the UI. A hidden field is one
 * careless template away from being displayed; an absent field cannot be.
 *
 * The rider receives: recipient name, phone, address, package reference.
 * The rider never receives: a diagnosis, a clinical note, a prescription, or a
 * medicine list.
 *
 * The rider is the least-trusted human actor in the system and needs the least
 * data. This minimisation is a DPPA 2019 obligation, not a UI convention.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 *
 * @mixin Delivery
 */
class RiderDeliveryResource extends JsonResource
{
    /**
     * @return array{
     *     id: string,
     *     reference: string,
     *     recipient_name: string,
     *     recipient_phone: string,
     *     address_text: string,
     *     district: ?string,
     *     landmark: ?string,
     *     status: string
     * }
     */
    public function toArray(Request $request): array
    {
        // Every field here is deliberate. Adding one is a disclosure decision
        // and must be justified against the rider rule above.
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'recipient_name' => $this->recipient_name,
            'recipient_phone' => $this->recipient_phone,
            'address_text' => $this->address_text,
            'district' => $this->district,
            'landmark' => $this->landmark,
            'status' => $this->status->value,
        ];
    }
}
