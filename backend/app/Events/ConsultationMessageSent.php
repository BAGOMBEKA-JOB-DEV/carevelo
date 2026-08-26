<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\ConsultationMessage;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * Somebody said something in a consultation. Never what they said.
 *
 * THE BODY IS THE WHOLE POINT OF THIS CLASS, BY ITS ABSENCE. Every other event
 * in this directory withholds clinical content that a subscriber would have to
 * fetch anyway; this one withholds the entire substance of the thing that
 * happened, which makes it the most tempting payload in the application to
 * "improve" -- a chat frame carrying the message text would let a client render
 * the conversation with no round trip, and that is exactly how a chat transcript
 * ends up on a channel wider than the conversation.
 *
 * It IS wider. `tenant.{id}.consultation.{id}` is authorised by
 * ConsultationChannel, which delegates to ConsultationPolicy::view -- so any
 * clinician or clinic administrator of the clinic may subscribe, while
 * ConsultationPolicy::participate lets only the patient and the conducting
 * clinician read the messages themselves. Those two answers are deliberately
 * different, and the difference is only safe because the frame carries
 * identifiers. A broadcast channel is not an authorisation boundary; the API is.
 *
 * TenantBroadcast enforces the rest structurally: promoted readonly strings, no
 * model, so there is no attribute bag for a body to arrive in and nothing for a
 * queue worker to re-hydrate.
 *
 * A HINT TO REFRESH, NEVER AUTHORITATIVE (rule 4). A dropped frame degrades
 * freshness and never correctness, which is what makes it acceptable that no
 * client consumes this yet: every live surface in the product is a fifteen-
 * second poll, and a chat that polls is a chat that works.
 *
 * @see docs/30-architecture/realtime-broadcasting.md
 */
final class ConsultationMessageSent extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $consultationId,
        public readonly string $messageId,
        public readonly string $authorRole,
    ) {
        parent::__construct($tenantId);
    }

    /**
     * Read attribute by attribute through TenantBroadcast's accessors, which is
     * the second half of the payload guarantee: the model is consulted here and
     * never stored, so it cannot be serialised onto the wire by accident.
     */
    public static function from(ConsultationMessage $message): self
    {
        return new self(
            self::tenantOf($message),
            self::stringAttribute($message, 'consultation_id'),
            self::keyOf($message),
            $message->author_role->value,
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [TenantChannel::consultation($this->tenantId, $this->consultationId)];
    }

    public function broadcastAs(): string
    {
        return 'consultation_message.sent';
    }

    /**
     * Identifiers and one closed-list role.
     *
     * `author_role` is who spoke, not what they said, and it is what makes the
     * frame useful without being a disclosure: the other participant's screen
     * can show that the person they are talking to has replied, and then fetch
     * the reply under the policy. It carries no information a subscriber to this
     * channel does not already hold -- they can read the consultation, so they
     * already know which clinician and which patient are in it.
     *
     * @return array<string, string|null>
     */
    public function broadcastWith(): array
    {
        return [
            'consultation_id' => $this->consultationId,
            'message_id' => $this->messageId,
            'author_role' => $this->authorRole,
        ];
    }
}
