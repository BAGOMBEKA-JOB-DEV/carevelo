<?php

namespace App\Http\Requests\V1\Patients\Concerns;

use Illuminate\Support\Carbon;
use Throwable;

/**
 * A patient under 18 consents through a guardian (§H2.4).
 *
 * Guardian name, relationship and phone stop being optional the moment the date
 * of birth says the patient is a minor. Without them the consent has no lawful
 * author, and registration cannot complete -- in-person care then proceeds
 * under the clinic's own paper processes.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 */
trait RequiresGuardianForMinors
{
    /** @var list<string> */
    protected array $guardianFields = ['guardian_name', 'guardian_phone', 'guardian_relationship'];

    protected function isMinor(mixed $dateOfBirth): bool
    {
        if ($dateOfBirth instanceof Carbon) {
            return $dateOfBirth->diffInYears(Carbon::now()) < 18;
        }

        if (! is_string($dateOfBirth) || trim($dateOfBirth) === '') {
            return false;
        }

        try {
            $parsed = Carbon::parse($dateOfBirth);
        } catch (Throwable) {
            // Malformed dates are the `date` rule's business, not ours. Saying
            // nothing here keeps one bad value to one error message.
            return false;
        }

        return $parsed->diffInYears(Carbon::now()) < 18;
    }

    protected function guardianMessage(): string
    {
        return 'A patient under 18 needs a guardian: their name, phone and relationship to the patient.';
    }
}
