<?php

namespace App\Http\Requests\Auth\Concerns;

use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Rules\UgandanPhone;

/**
 * The `phone` field an authentication request may take.
 *
 * Normalised to E.164 before the rules run, so "0772 123 456" and
 * "+256772123456" are one identity and not two -- which is what makes
 * (tenant_id, phone) usable as the account key, and what stops a mistyped
 * format producing a sign-in failure for an account that exists.
 */
trait ResolvesPhoneNumber
{
    use NormalisesPhoneNumbers;

    protected function prepareForValidation(): void
    {
        $this->normalisePhoneFields(['phone']);
    }

    /**
     * The format rule on its own, for a request to compose into its own set.
     *
     * A rule rather than a ready-made `phone => [...]` entry, because the number is
     * not simply required: SignInRequest takes it as one of two possible identifiers,
     * and a trait that decided the field was mandatory would be wrong about the only
     * request that uses it.
     */
    protected function phoneRule(): UgandanPhone
    {
        return new UgandanPhone;
    }
}
