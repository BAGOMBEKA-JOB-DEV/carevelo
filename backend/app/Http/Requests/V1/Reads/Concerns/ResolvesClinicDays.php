<?php

namespace App\Http\Requests\V1\Reads\Concerns;

use App\Models\Tenant;
use Carbon\CarbonImmutable;

/**
 * Date filters resolved in the CLINIC'S own day, not UTC's.
 *
 * An administrator in Kampala asking for "yesterday" means the day they worked.
 * Resolving a bare Y-m-d in UTC shifts the window three hours and quietly moves
 * the first and last transactions of every day into the wrong one -- which is
 * discovered when a clinic's own totals disagree with ours and nobody can say
 * why.
 *
 * The timezone comes from the tenant record bound by ResolveTenant, never from
 * the client: a caller who could choose the timezone could choose which day a
 * payment falls in.
 */
trait ResolvesClinicDays
{
    /** Midnight at the start of the requested day, in the clinic's timezone. */
    protected function dayStart(string $key): ?CarbonImmutable
    {
        return $this->clinicDay($key)?->startOfDay();
    }

    /** The last instant of the requested day, so the range is inclusive. */
    protected function dayEnd(string $key): ?CarbonImmutable
    {
        return $this->clinicDay($key)?->endOfDay();
    }

    protected function clinicToday(): CarbonImmutable
    {
        return CarbonImmutable::now($this->clinicTimezone())->startOfDay();
    }

    protected function clinicTimezone(): string
    {
        $tenant = $this->attributes->get('tenant');

        if (! $tenant instanceof Tenant) {
            return 'Africa/Kampala';
        }

        $timezone = $tenant->getAttribute('timezone');

        return is_string($timezone) && $timezone !== '' ? $timezone : 'Africa/Kampala';
    }

    private function clinicDay(string $key): ?CarbonImmutable
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== ''
            ? CarbonImmutable::parse($value, $this->clinicTimezone())
            : null;
    }
}
