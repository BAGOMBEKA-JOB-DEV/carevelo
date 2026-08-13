<?php

namespace Database\Factories;

use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\Patient;
use App\Models\Prescription;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<DispenseOrder> */
class DispenseOrderFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'reference' => 'RX-2608-'.Str::padLeft((string) fake()->unique()->numberBetween(1, 9999), 4, '0'),
            'prescription_id' => Prescription::factory(),
            'patient_id' => Patient::factory(),
            'status' => DispenseOrderStatus::Received,
            'currency' => 'UGX',
        ];
    }

    public function paid(): static
    {
        return $this->state(fn () => ['status' => DispenseOrderStatus::Paid]);
    }
}
