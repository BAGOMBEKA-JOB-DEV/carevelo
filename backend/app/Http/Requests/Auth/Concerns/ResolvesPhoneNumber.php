<?php

namespace App\Http\Requests\Auth\Concerns;

use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Rules\UgandanPhone;
use App\Support\PhoneNumber;

/**
 * The `phone` field every authentication endpoint takes.
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
     * @return array<string, mixed>
     */
    protected function phoneRules(): array
    {
        return ['phone' => ['required', 'string', $this->phoneRule()]];
    }

    /**
     * The format rule on its own.
     *
     * Separate from phoneRules() because SignInRequest composes its own set: there the
     * number is one of two possible identifiers rather than a required field.
     */
    protected function phoneRule(): UgandanPhone
    {
        return new UgandanPhone;
    }

    /** The validated number in E.164, ready to use as a lookup key. */
    public function phone(): string
    {
        return PhoneNumber::parse((string) $this->validated('phone'))->e164;
    }
}
