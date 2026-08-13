<?php

namespace App\Http\Resources\V1;

use App\Models\ClinicalNote;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A clinician's note.
 *
 * `body` is special-category health data under DPPA 2019 and this is the ONLY
 * place it is ever serialised: in-app, over an authenticated request, to a
 * clinical role. It never reaches a notification, a log line, an audit event,
 * an error response or a rider payload.
 *
 * `supersedes_note_id` being populated means this note is a correction of
 * another. The superseded note is still returned by the collection -- suppressing
 * it would be exactly the silent rewrite the addendum mechanism exists to
 * prevent.
 *
 * @mixin ClinicalNote
 */
class ClinicalNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'consultation_id' => $this->consultation_id,
            'author_id' => $this->author_id,
            'note_type' => $this->note_type,
            'body' => $this->body,
            'supersedes_note_id' => $this->supersedes_note_id,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
