<?php

namespace App\Http\Requests\Admin\WorkingHours;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Replaces the clinic's whole week of opening hours.
 *
 * PUT on a collection, so the body is the timetable in full rather than a
 * patch. A clinic that stops opening on Saturdays says so by sending a week
 * without Saturday, and a partial-update endpoint would leave that Saturday
 * quietly published to patients forever.
 *
 * `day_of_week` is 0 = Sunday, matching Carbon. It is `distinct` because the
 * table is uniquely keyed on (tenant_id, day_of_week): two Mondays in one body
 * is a client bug, and letting the second silently win means the clinic sees
 * hours it did not choose.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 */
class UpdateWorkingHoursRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Accepted wall-clock formats. Seconds are tolerated, never required. */
    public const TIME_FORMATS = 'H:i,H:i:s';

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'days' => ['required', 'array', 'min:1', 'max:7'],
            'days.*.day_of_week' => ['required', 'integer', 'between:0,6', 'distinct'],

            // Not required on a day the clinic is shut: the columns are NOT
            // NULL, so the controller stores midnight-to-midnight and nothing
            // ever reads it while is_closed is true.
            'days.*.opens_at' => [
                'required_unless:days.*.is_closed,true', 'nullable', 'date_format:'.self::TIME_FORMATS,
            ],
            'days.*.closes_at' => [
                'required_unless:days.*.is_closed,true', 'nullable', 'date_format:'.self::TIME_FORMATS,
            ],
            'days.*.is_closed' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                foreach ($this->unknownFields() as $field) {
                    $validator->errors()->add($field, 'This field is not recognised.');
                }
            },
            function (Validator $validator): void {
                $this->assertClosingFollowsOpening($validator);
            },
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'days.*.day_of_week.between' => 'Days run from 0 (Sunday) to 6 (Saturday).',
            'days.*.day_of_week.distinct' => 'That day appears twice.',
            'days.*.opens_at.date_format' => 'Give the opening time as HH:MM.',
            'days.*.closes_at.date_format' => 'Give the closing time as HH:MM.',
        ];
    }

    /**
     * The week, normalised: one entry per day, times as `H:i:s`.
     *
     * @return list<array{day_of_week: int, opens_at: string, closes_at: string, is_closed: bool}>
     */
    public function week(): array
    {
        /** @var list<array<string, mixed>> $days */
        $days = $this->safe()->array('days');

        return array_map(static function (array $day): array {
            $isClosed = (bool) ($day['is_closed'] ?? false);

            return [
                'day_of_week' => (int) $day['day_of_week'],
                'opens_at' => $isClosed ? '00:00:00' : self::normaliseTime($day['opens_at'] ?? null),
                'closes_at' => $isClosed ? '00:00:00' : self::normaliseTime($day['closes_at'] ?? null),
                'is_closed' => $isClosed,
            ];
        }, $days);
    }

    /**
     * A closing time must come after the opening time.
     *
     * Only where the clinic is actually open. An overnight clinic is not a
     * supported shape -- a service crossing midnight would need a second row and
     * a range type, and inventing that from an ambiguous 22:00-02:00 would
     * publish availability nobody staffs.
     */
    protected function assertClosingFollowsOpening(Validator $validator): void
    {
        if ($validator->errors()->isNotEmpty()) {
            return;
        }

        /** @var list<array<string, mixed>> $days */
        $days = (array) $this->input('days', []);

        foreach ($days as $index => $day) {
            if ((bool) ($day['is_closed'] ?? false)) {
                continue;
            }

            $opens = self::normaliseTime($day['opens_at'] ?? null);
            $closes = self::normaliseTime($day['closes_at'] ?? null);

            if ($closes <= $opens) {
                $validator->errors()->add(
                    "days.{$index}.closes_at",
                    'The clinic must close after it opens. Mark the day closed instead.',
                );
            }
        }
    }

    /** `H:i` and `H:i:s` both compare correctly once padded to `H:i:s`. */
    protected static function normaliseTime(mixed $time): string
    {
        $value = is_string($time) ? $time : '';

        return substr($value.':00', 0, 8);
    }
}
