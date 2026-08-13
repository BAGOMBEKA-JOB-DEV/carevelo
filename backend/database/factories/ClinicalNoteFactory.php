<?php

namespace Database\Factories;

use App\Models\ClinicalNote;
use App\Models\Consultation;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * ClinicalNote deliberately does not use HasFactory -- there is no
 * ClinicalNote::factory() -- so call this as ClinicalNoteFactory::new().
 *
 * @extends Factory<ClinicalNote>
 */
class ClinicalNoteFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'consultation_id' => Consultation::factory(),
            'author_id' => User::factory(),
            'body' => fake()->paragraph(),
            'note_type' => 'subjective',
        ];
    }

    /**
     * A note as it exists mid-typing.
     *
     * Drafts are saved as they are written, so a half-finished sentence is a
     * perfectly valid stored note -- not an edge case to be tidied away.
     */
    public function draft(): static
    {
        return $this->state(fn () => ['body' => 'Patient reports a cough that started']);
    }

    /**
     * A correction of an existing note.
     *
     * Note what this does NOT do: it leaves the superseded note exactly as it
     * was written.
     */
    public function supersedes(ClinicalNote $original): static
    {
        return $this->state(fn () => [
            'consultation_id' => $original->consultation_id,
            'note_type' => 'addendum',
            'supersedes_note_id' => $original->id,
        ]);
    }
}
