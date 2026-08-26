<?php

namespace Database\Factories;

use App\Models\Consultation;
use App\Models\ConsultationMessage;
use App\Models\ConsultationMessageAuthor;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * ConsultationMessage deliberately does not use HasFactory -- there is no
 * ConsultationMessage::factory() -- so call this as
 * ConsultationMessageFactory::new(), exactly as ClinicalNoteFactory is called.
 *
 * The model's surface stays limited to what production uses, and a factory
 * reachable from the model is one step from a factory reachable in production
 * code.
 *
 * @extends Factory<ConsultationMessage>
 */
class ConsultationMessageFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'consultation_id' => Consultation::factory(),
            'author_id' => User::factory(),
            'author_role' => ConsultationMessageAuthor::Clinician,
            'body' => fake()->sentence(),
        ];
    }

    /**
     * The patient's half of the conversation.
     *
     * Worth a state of its own rather than a parameter at each call site: the
     * test that matters most in this domain is the one proving a patient can
     * speak at all, and a transcript with only one voice in it would not have
     * caught the bug that test exists for.
     */
    public function fromPatient(): static
    {
        return $this->state(fn () => ['author_role' => ConsultationMessageAuthor::Patient]);
    }
}
