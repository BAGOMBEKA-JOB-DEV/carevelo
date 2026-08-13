<?php

namespace Database\Factories;

use App\Models\DispenseOrder;
use App\Models\PrescriptionItem;
use App\Models\Substitution;
use App\Models\SubstitutionStatus;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Substitution> */
class SubstitutionFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'dispense_order_id' => DispenseOrder::factory(),
            'prescription_item_id' => PrescriptionItem::factory(),
            'proposed_medicine_name' => 'Amoxicillin 250mg',
            'reason' => 'Prescribed strength out of stock',
            'proposed_by' => 'pharmacist-01',
            'proposed_at' => now(),
            'status' => SubstitutionStatus::Pending,
        ];
    }
}
