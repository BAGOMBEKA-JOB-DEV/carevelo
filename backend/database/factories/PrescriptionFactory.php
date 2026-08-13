<?php

namespace Database\Factories;

use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\PrescriptionStatus;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Prescription> */
class PrescriptionFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'consultation_id' => Consultation::factory(),
            'clinician_id' => Clinician::factory(),
            'patient_id' => Patient::factory(),
            'clinician_name_snapshot' => 'Dr '.fake()->lastName(),
            'clinician_registration_snapshot' => 'UMDPC-'.fake()->numerify('#####'),
            'registration_body_snapshot' => 'umdpc',
            'issued_at' => now(),
            'status' => PrescriptionStatus::Issued,
        ];
    }
}
