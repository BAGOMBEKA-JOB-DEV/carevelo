<?php

namespace Database\Factories;

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\Clinician;
use App\Models\ConsultationMode;
use App\Models\Patient;
use App\Models\Service;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Appointment> */
class AppointmentFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'reference' => 'APT-2608-'.Str::padLeft((string) fake()->unique()->numberBetween(1, 9999), 4, '0'),
            'patient_id' => Patient::factory(),
            'clinician_id' => Clinician::factory(),
            'service_id' => Service::factory(),
            'scheduled_start_at' => now()->addDay(),
            'scheduled_end_at' => now()->addDay()->addMinutes(30),
            'mode_booked' => ConsultationMode::Video,
            'payment_expectation' => 'prepaid',
            'status' => AppointmentStatus::Confirmed,
        ];
    }

    public function awaitingPayment(): static
    {
        return $this->state(fn () => ['status' => AppointmentStatus::AwaitingPayment]);
    }
}
