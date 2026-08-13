<?php

namespace App\Http\Requests\V1\Patients\Concerns;

use App\Support\PhoneNumber;

/**
 * Normalises Ugandan phone numbers to E.164 before the rules run.
 *
 * Ugandans write the same number at least six ways. Normalising once, at the
 * boundary, is what makes (tenant_id, phone) a usable uniqueness constraint --
 * and what stops a mistyped format creating a second record for a person who
 * already has one.
 *
 * An unparseable value is deliberately left untouched so the UgandanPhone rule
 * produces the friendly, format-showing message rather than a bare "invalid".
 */
trait NormalisesPhoneNumbers
{
    /**
     * @param  list<string>  $fields
     */
    protected function normalisePhoneFields(array $fields): void
    {
        foreach ($fields as $field) {
            $raw = $this->input($field);

            if (! is_string($raw)) {
                continue;
            }

            $parsed = PhoneNumber::tryParse($raw);

            if ($parsed !== null) {
                $this->merge([$field => $parsed->e164]);
            }
        }
    }
}
