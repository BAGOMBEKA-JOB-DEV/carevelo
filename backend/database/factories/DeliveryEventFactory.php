<?php

namespace Database\Factories;

use App\Models\Delivery;
use App\Models\DeliveryEvent;
use App\Models\DeliveryStatus;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * The delivery status thread.
 *
 * Events are normally written by Delivery::transitionTo(), never by hand. This
 * factory exists for the tests that must construct a thread the transitions
 * cannot reach — in particular one carrying a `note`, to prove the tracking
 * endpoint does not read that column.
 *
 * @extends Factory<DeliveryEvent>
 */
class DeliveryEventFactory extends Factory
{
    /** @var class-string<DeliveryEvent> */
    protected $model = DeliveryEvent::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'delivery_id' => Delivery::factory(),
            'from_status' => DeliveryStatus::Unassigned->value,
            'to_status' => DeliveryStatus::Assigned->value,
            'occurred_at' => now(),
        ];
    }

    public function transition(DeliveryStatus $from, DeliveryStatus $to): static
    {
        return $this->state(fn () => [
            'from_status' => $from->value,
            'to_status' => $to->value,
        ]);
    }

    /**
     * An event carrying operational free text.
     *
     * Free text is where clinical content escapes, which is exactly why the
     * patient-facing tracking view never reads this column.
     */
    public function withNote(string $note): static
    {
        return $this->state(fn () => ['note' => $note]);
    }
}
