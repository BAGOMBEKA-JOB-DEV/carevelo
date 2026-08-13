<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/** @see docs/20-domain/state-machines.md */
enum PrescriptionStatus: string
{
    use TransitsState;

    case Issued = 'issued';
    case Cancelled = 'cancelled';
    case Superseded = 'superseded';

    /**
     * There is deliberately no Draft state.
     *
     * A prescription exists from the moment it is issued; before that there is
     * only an unsaved form. A half-written prescription is not a clinical
     * document.
     *
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            // Cancellation after dispensing is still permitted and recorded --
            // it happens, and the record must reflect it rather than refuse it.
            self::Issued => [self::Cancelled, self::Superseded],
            self::Cancelled, self::Superseded => [],
        };
    }
}
