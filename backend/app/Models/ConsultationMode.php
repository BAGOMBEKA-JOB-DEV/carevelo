<?php

namespace App\Models;

/**
 * Voice and chat are FIRST-CLASS modes, not degraded fallbacks.
 *
 * A patient on a poor connection -- which in this market is a large share of
 * them at any moment -- must be able to choose voice deliberately rather than
 * fight a failing video call.
 */
enum ConsultationMode: string
{
    case InPerson = 'in_person';
    case Video = 'video';
    case Voice = 'voice';
    case Chat = 'chat';

    /** The mode one step down the degradation ladder. */
    public function degraded(): ?self
    {
        return match ($this) {
            self::Video => self::Voice,
            self::Voice => self::Chat,
            self::Chat, self::InPerson => null,
        };
    }
}
