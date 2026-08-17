<?php

namespace Database\Factories;

use App\Models\WorkingHour;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<WorkingHour> */
class WorkingHourFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            // Monday by default. There is no sensible random day: the table is
            // uniquely keyed on (tenant_id, day_of_week), so a random one turns
            // a second create() into an intermittent constraint violation.
            'day_of_week' => 1,
            'opens_at' => '08:00:00',
            'closes_at' => '17:00:00',
            'is_closed' => false,
        ];
    }

    public function forDay(int $dayOfWeek): static
    {
        return $this->state(fn () => ['day_of_week' => $dayOfWeek]);
    }

    /**
     * A day the clinic does not open.
     *
     * The times are still stored -- the columns are NOT NULL -- and are simply
     * never read while is_closed is true.
     */
    public function closed(): static
    {
        return $this->state(fn () => [
            'is_closed' => true,
            'opens_at' => '00:00:00',
            'closes_at' => '00:00:00',
        ]);
    }

    public function opening(string $opensAt, string $closesAt): static
    {
        return $this->state(fn () => [
            'opens_at' => $opensAt,
            'closes_at' => $closesAt,
        ]);
    }
}
