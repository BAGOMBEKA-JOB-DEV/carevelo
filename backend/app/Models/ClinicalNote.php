<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * A clinician's record within a consultation.
 *
 * Never destructively edited. A correction is a NEW note of type addendum with
 * supersedes_note_id set; the original stays. A medical record that can be
 * silently rewritten is not a medical record.
 *
 * @property string $id
 * @property string $body
 * @property string $note_type
 */
class ClinicalNote extends Model
{
    use BelongsToTenant;
    use HasUlids;

    protected $fillable = [
        'consultation_id', 'author_id', 'body', 'note_type', 'supersedes_note_id',
    ];

    protected static function booted(): void
    {
        static::updating(function (ClinicalNote $note): void {
            if ($note->isDirty('body')) {
                throw new LogicException(
                    'Clinical notes are never edited. Add an addendum that supersedes '
                    .'this note instead -- the original must remain.'
                );
            }
        });

        static::deleting(function (): never {
            throw new LogicException('Clinical notes are never deleted.');
        });
    }

    /** Correct this note by appending an addendum. */
    public function addendum(string $body, string $authorId): self
    {
        return static::create([
            'consultation_id' => $this->consultation_id,
            'author_id' => $authorId,
            'body' => $body,
            'note_type' => 'addendum',
            'supersedes_note_id' => $this->id,
        ]);
    }
}
