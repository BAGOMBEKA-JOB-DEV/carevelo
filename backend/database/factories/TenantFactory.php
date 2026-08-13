<?php

namespace Database\Factories;

use App\Models\Tenant;
use App\Models\TenantStatus;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Tenant>
 */
class TenantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->company();
        $slug = Str::slug($name).'-'.Str::lower(Str::random(4));

        return [
            'slug' => $slug,
            'subdomain' => $slug,
            'legal_name' => $name.' Medical Centre',
            'trading_name' => $name,
            'contact_phone' => '+2567'.fake()->numerify('########'),
            'contact_email' => fake()->safeEmail(),
            'district' => fake()->randomElement(['Kampala', 'Wakiso', 'Mukono']),
            'status' => TenantStatus::Active,
            'timezone' => 'Africa/Kampala',
            'currency' => 'UGX',
        ];
    }

    public function provisioning(): static
    {
        return $this->state(fn () => ['status' => TenantStatus::Provisioning]);
    }

    public function suspended(): static
    {
        return $this->state(fn () => ['status' => TenantStatus::Suspended]);
    }
}
