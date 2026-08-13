<?php

namespace Database\Factories;

use App\Models\Prescription;
use App\Models\PrescriptionItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PrescriptionItem> */
class PrescriptionItemFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'prescription_id' => Prescription::factory(),
            'medicine_name' => 'Amoxicillin 500mg',
            'form' => 'capsule',
            'quantity' => 21,
            'directions' => 'One capsule three times daily for seven days',
            'is_controlled' => false,
        ];
    }

    /** Requires in-person handling under NDPA Act Cap 206. */
    public function controlled(): static
    {
        return $this->state(fn () => ['is_controlled' => true, 'medicine_name' => 'Pethidine 50mg']);
    }
}
