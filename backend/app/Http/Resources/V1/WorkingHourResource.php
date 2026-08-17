<?php

namespace App\Http\Resources\V1;

use App\Models\WorkingHour;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One day of the clinic's opening hours.
 *
 * Times are wall-clock strings in the clinic's own timezone, trimmed to `H:i`.
 * They are deliberately NOT rendered as instants: "we open at eight" is a
 * recurring local fact, and an ISO-8601 timestamp would need a date to be
 * meaningful and would silently shift when the client's own timezone differed.
 *
 * `day_of_week` is 0 = Sunday. `day` carries the name alongside it so a client
 * never has to hardcode that mapping and get it wrong in one place only.
 *
 * @mixin WorkingHour
 */
class WorkingHourResource extends JsonResource
{
    /**
     * @return array{day_of_week: int, day: string, opens_at: string, closes_at: string, is_closed: bool}
     */
    public function toArray(Request $request): array
    {
        return [
            'day_of_week' => $this->day_of_week,
            'day' => $this->dayName(),
            'opens_at' => $this->asWallClock($this->opens_at),
            'closes_at' => $this->asWallClock($this->closes_at),
            'is_closed' => $this->is_closed,
        ];
    }

    /** PostgreSQL returns `time` as `H:i:s`; clinics do not schedule by second. */
    private function asWallClock(string $time): string
    {
        return substr($time, 0, 5);
    }
}
