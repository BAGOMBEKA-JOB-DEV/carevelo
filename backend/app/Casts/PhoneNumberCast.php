<?php

namespace App\Casts;

use App\Support\PhoneNumber;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * Normalises phone numbers to E.164 on write, hydrates a PhoneNumber on read.
 *
 * Accepts either a PhoneNumber or a raw string on set, so a form request can
 * assign the validated input directly. Invalid strings throw, because storing
 * an unparseable number means a notification silently never arrives.
 *
 * @implements CastsAttributes<PhoneNumber, PhoneNumber|string>
 */
class PhoneNumberCast implements CastsAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?PhoneNumber
    {
        if ($value === null || $value === '') {
            return null;
        }

        return PhoneNumber::parse((string) $value);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof PhoneNumber) {
            return $value->e164;
        }

        return PhoneNumber::parse((string) $value)->e164;
    }
}
