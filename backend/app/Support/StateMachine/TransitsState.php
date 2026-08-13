<?php

namespace App\Support\StateMachine;

use App\Exceptions\StateMachine\IllegalTransition;

/**
 * Guard rails for a state enum.
 *
 * State transitions are methods that throw, never attribute assignment:
 *
 *     $order->dispense($pharmacistId);   // yes
 *     $order->status = 'dispensed';      // never
 *
 * A status column that anything can assign is not a state machine, it is a
 * string field with a hopeful name. Preconditions such as "cannot dispense
 * while a substitution is pending" live in the model, where a controller in a
 * hurry cannot bypass them.
 *
 * Every enum using this trait must declare allowedTransitions().
 *
 * @see docs/20-domain/state-machines.md
 */
trait TransitsState
{
    public function canTransitionTo(self $target): bool
    {
        return in_array($target, $this->allowedTransitions(), true);
    }

    /**
     * @throws IllegalTransition
     */
    public function assertCanTransitionTo(self $target): void
    {
        if (! $this->canTransitionTo($target)) {
            throw IllegalTransition::between($this, $target);
        }
    }

    public function isFinal(): bool
    {
        return $this->allowedTransitions() === [];
    }

    /**
     * Every state reachable from here, transitively.
     *
     * Used by tests to assert a machine has no unreachable states and no
     * accidental dead ends — a state you can enter but never leave, other than
     * a deliberate final state, is almost always a bug.
     *
     * @return list<self>
     */
    public function reachableStates(): array
    {
        $seen = [];
        $queue = [$this];

        while ($queue !== []) {
            $current = array_shift($queue);

            foreach ($current->allowedTransitions() as $next) {
                if (! in_array($next, $seen, true)) {
                    $seen[] = $next;
                    $queue[] = $next;
                }
            }
        }

        return $seen;
    }
}
