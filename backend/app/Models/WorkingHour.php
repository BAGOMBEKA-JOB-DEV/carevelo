<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\WorkingHourFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * When one clinic is open on one day of the week.
 *
 * The clinic's own hours, per tenant. There is no platform timetable, for the
 * same reason there is no platform price list: a clinic in Mbarara that opens
 * at seven and closes at four is not misconfigured.
 *
 * `day_of_week` is 0 = Sunday, matching Carbon's `dayOfWeek`. Aligning with
 * Carbon rather than ISO-8601 (1 = Monday) is deliberate: availability is
 * computed by walking Carbon dates, and a one-off translation layer between the
 * stored integer and the runtime one is exactly where an off-by-one silently
 * moves a whole clinic's Sunday hours onto Monday.
 *
 * `opens_at` and `closes_at` are PostgreSQL `time` columns and are read as
 * wall-clock strings, not instants. They are LOCAL to the clinic: the tenant's
 * own timezone turns them into a moment, which is why the helpers below take
 * the day they are being applied to rather than assuming one.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property int $day_of_week
 * @property string $opens_at
 * @property string $closes_at
 * @property bool $is_closed
 */
class WorkingHour extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<WorkingHourFactory> */
    use HasFactory;

    use HasUlids;

    /** Sunday first, matching the stored integer. */
    public const DAY_NAMES = [
        0 => 'sunday',
        1 => 'monday',
        2 => 'tuesday',
        3 => 'wednesday',
        4 => 'thursday',
        5 => 'friday',
        6 => 'saturday',
    ];

    protected $fillable = [
        'day_of_week', 'opens_at', 'closes_at', 'is_closed',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'day_of_week' => 'integer',
            'is_closed' => 'boolean',
        ];
    }

    /**
     * The moment this day's doors open, in whatever timezone `$day` carries.
     *
     * `$day` is expected to be a clinic-local date. Handing it a UTC instant
     * produces a UTC answer, which is correct arithmetic and the wrong clinic
     * hours -- the caller owns the timezone decision.
     */
    public function opensOn(Carbon $day): Carbon
    {
        return $day->copy()->setTimeFromTimeString($this->opens_at);
    }

    public function closesOn(Carbon $day): Carbon
    {
        return $day->copy()->setTimeFromTimeString($this->closes_at);
    }

    /** The day name, for a client that would otherwise hardcode the mapping. */
    public function dayName(): string
    {
        return self::DAY_NAMES[$this->day_of_week] ?? 'unknown';
    }
}
