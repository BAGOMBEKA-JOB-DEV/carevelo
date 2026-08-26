<?php

namespace App\Http\Resources\V1;

use App\Models\ConsultationMessage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One line of a consultation's chat transcript.
 *
 * `body` is special-category health data under DPPA 2019 and this resource is
 * the ONLY place it is ever serialised for a participant: in-app, over an
 * authenticated request, to one of the two people who were in the encounter. It
 * never reaches a notification, a log line, an audit event, an error response, a
 * rider payload or a broadcast frame -- and the broadcast is the one worth
 * naming, because ConsultationMessageSent travels on a channel a clinic
 * administrator may legitimately subscribe to while being unable to read this.
 * A channel is not an authorisation boundary; this resource is.
 *
 * `author_role` is returned as well as `author_id` so a client can render the
 * two sides without a second request, and so the transcript stays readable when
 * an account is later deactivated.
 *
 * @mixin ConsultationMessage
 */
class ConsultationMessageResource extends JsonResource
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
            'author_role' => $this->author_role->value,
            'body' => $this->body,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
