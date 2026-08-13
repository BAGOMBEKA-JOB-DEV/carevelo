<?php

namespace Database\Factories;

use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\DispenseOrder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Delivery> */
class DeliveryFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'reference' => 'DLV-2608-'.Str::padLeft((string) fake()->unique()->numberBetween(1, 9999), 4, '0'),
            'dispense_order_id' => DispenseOrder::factory(),
            'recipient_name' => fake()->name(),
            'recipient_phone' => '+2567'.fake()->numerify('########'),
            'address_text' => fake()->streetAddress(),
            'district' => 'Kampala',
            'status' => DeliveryStatus::Unassigned,
        ];
    }
}
