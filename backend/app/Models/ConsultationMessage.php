<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * One chat message inside a consultation. Part of the clinical record.
 *
 * The sibling of ClinicalNote, not of a messaging inbox. A clinician typing
 * "take one tablet twice daily with food" into chat has issued a clinical
 * instruction, and a patient typing "the pain moved to my right side" has given
 * history. Neither becomes less clinical for having arrived over a chat
 * transport, and the non-goal that says consultations are not recorded is about
 * MEDIA -- see docs/30-architecture/realtime-and-video.md, which states the
 * positive rule for text.
 *
 * APPEND-ONLY, AND STRICTER THAN ClinicalNote.
 *
 * ClinicalNote refuses a changed `body` and refuses deletion, but permits other
 * columns to move, because it has a correction mechanism of its own: an
 * addendum is a NEW note carrying supersedes_note_id, and `note_type` is part
 * of that machinery. Chat has no such mechanism and needs none -- a person who
 * mistyped something in a conversation corrects it by sending another message,
 * which is what they would do anyway and which leaves the mistake visible, as a
 * medical record requires. So there is no legitimate mutation of a sent message
 * at all, and ANY update throws rather than only a changed body. A narrower
 * guard here would be a guard with nothing behind it.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $consultation_id
 * @property string $author_id
 * @property ConsultationMessageAuthor $author_role
 * @property string $body
 */
class ConsultationMessage extends Model
{
    use BelongsToTenant;
    use HasUlids;

    /**
     * author_role is fillable but is never client input.
     *
     * The controller derives it from the authorisation decision it has just
     * made. StoreConsultationMessageRequest defines no field for it, and
     * RejectsUnknownFields turns an attempt to supply one into a 422 -- which
     * matters, because a patient who could assert author_role could put words
     * in their clinician's mouth inside the clinical record.
     *
     * @var list<string>
     */
    protected $fillable = ['consultation_id', 'author_id', 'author_role', 'body'];

    protected static function booted(): void
    {
        static::updating(function (): never {
            throw new LogicException(
                'A consultation message is never edited. Send another message '
                .'instead -- the conversation is the record, and a correction '
                .'that hides what was originally said is not a correction.'
            );
        });

        static::deleting(function (): never {
            throw new LogicException('Consultation messages are never deleted.');
        });
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'author_role' => ConsultationMessageAuthor::class,
        ];
    }
}
