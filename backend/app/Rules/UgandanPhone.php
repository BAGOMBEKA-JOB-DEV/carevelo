<?php

namespace App\Rules;

use App\Support\PhoneNumber;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

/**
 * Validates a Ugandan phone number in any of the forms people actually write.
 *
 * The message is deliberately the same one the API promises elsewhere, and it
 * shows the expected format rather than merely saying "invalid" — a patient
 * abandoning registration because the error was unhelpful is a lost patient.
 */
class UgandanPhone implements ValidationRule
{
    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || PhoneNumber::tryParse($value) === null) {
            $fail('Enter a valid Ugandan phone number, for example 0772 123 456.');
        }
    }
}
