<?php

namespace Database\Factories;

use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\ConsultationMode;
use App\Models\ConsultationOutcome;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Consultation> */
class ConsultationFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'appointment_id' => AppointmentFactory::new(),
            'patient_id' => Patient::factory(),
            'clinician_id' => Clinician::factory(),
            'started_at' => now()->subMinutes(20),
            'ended_at' => now(),
            'mode_used' => ConsultationMode::Video,
            'outcome' => ConsultationOutcome::Completed,
        ];
    }

    /** The clinician judged remote care unsafe: no prescription may follow. */
    public function convertedToInPerson(): static
    {
        return $this->state(fn () => ['outcome' => ConsultationOutcome::ConvertedToInPerson]);
    }

    public function degradedToVoice(): static
    {
        return $this->state(fn () => ['mode_used' => ConsultationMode::Voice]);
    }
}
