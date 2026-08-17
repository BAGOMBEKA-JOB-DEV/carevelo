<?php

namespace App\Http\Resources\V1;

use App\Models\AggregatorAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * The clinic's aggregator connection, WITHOUT ITS CREDENTIALS.
 *
 * This class is the reason AggregatorAccountPolicy::viewSecrets() can return
 * false for every role and mean it. There is no field here that holds a key,
 * no conditional that could add one, and no `whenLoaded` that reaches back into
 * the model. The credentials are write-only: not readable by the administrator
 * who entered them, not by Carevelo, not by a platform operator with a
 * break-glass grant. Phishing this endpoint yields four facts and no secret.
 *
 * `status = unconfigured` IS A WORKING STATE, not an error. A clinic with no
 * merchant account runs on pay-at-clinic and its patients are seen exactly as
 * they would be otherwise. Payment is a feature; care is not blocked on it.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 5
 *
 * @mixin AggregatorAccount
 */
class AggregatorAccountResource extends JsonResource
{
    /**
     * Every field is enumerated deliberately. Adding one is a disclosure
     * decision about a clinic's merchant credentials.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $lastVerifiedAt = $this->last_verified_at;
        $status = $this->status;

        return [
            'provider' => $this->provider,
            'status' => $status,
            'environment' => $this->environment,
            'last_verified_at' => $lastVerifiedAt instanceof Carbon
                ? $lastVerifiedAt->toIso8601String()
                : null,

            // Whether the clinic can take an online collection right now. The
            // console needs one boolean rather than a status vocabulary, and
            // this is the question it is actually asking.
            'accepts_online_payment' => $this->isUsable(),

            // Said in plain words on every response, because the alternative is
            // a console that renders a missing payment account as a blocking
            // error and a clinic that stops booking patients over it.
            'fallback' => 'Appointments and dispensing continue on pay-at-clinic whenever online '
                .'collection is unavailable.',

            'credentials_are_write_only' => true,
        ];
    }
}
