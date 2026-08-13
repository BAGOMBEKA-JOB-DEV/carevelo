<?php

namespace App\Exceptions\StateMachine;

use BackedEnum;
use DomainException;
use UnitEnum;

/**
 * Thrown when a state transition that the machine does not permit is attempted.
 *
 * @see docs/20-domain/state-machines.md
 */
class IllegalTransition extends DomainException
{
    public static function between(UnitEnum $from, UnitEnum $to): self
    {
        return new self(sprintf(
            'Cannot transition %s from %s to %s.',
            class_basename($from),
            self::label($from),
            self::label($to),
        ));
    }

    protected static function label(UnitEnum $state): string
    {
        return $state instanceof BackedEnum ? (string) $state->value : $state->name;
    }
}
