<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Sending a chat message inside a consultation.
 *
 * ONE FIELD, AND THE ABSENCES ARE THE DESIGN.
 *
 * There is no `author_id` and no `author_role`. Both are derived from the
 * authenticated session and from the authorisation decision the controller has
 * just made. A client that could assert either could put words into the other
 * participant's mouth inside a clinical record, and RejectsUnknownFields turns
 * the attempt into a 422 rather than silently discarding it.
 *
 * There is no `consultation_id` either: the encounter comes from the path and
 * is bound under row-level security, so a message cannot be addressed to an
 * encounter the sender cannot see.
 *
 * THE LENGTH LIMIT IS 4,000 AND NOT THE NOTE'S 20,000. A note is a document a
 * clinician composes; a chat message is a turn in a conversation. Someone
 * pasting four thousand characters into a chat window is writing a note, and
 * they should write it as a note where the addendum mechanism exists. The limit
 * is generous enough that no real message meets it and small enough that the
 * transcript stays a transcript.
 *
 * @see docs/30-architecture/realtime-and-video.md
 */
class StoreConsultationMessageRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            // Not nullable and not `sometimes`. An empty message is not a turn
            // in a conversation, and a chat log full of blank lines makes the
            // clinical record harder to read for no gain to anybody.
            'body' => ['required', 'string', 'max:4000'],
        ];
    }
}
