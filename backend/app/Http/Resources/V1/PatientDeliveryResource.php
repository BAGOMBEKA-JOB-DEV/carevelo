<?php

namespace App\Http\Resources\V1;

use App\Models\Delivery;
use App\Models\DeliveryEvent;
use App\Policies\DeliveryPolicy;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A delivery, as the PATIENT WAITING FOR IT sees it.
 *
 * A THIRD RESOURCE CLASS, AND THE THIRD IS NOT AN ACCIDENT. There is now one per
 * audience — `DeliveryResource` for the dispatcher, `RiderDeliveryResource` for
 * the rider, and this one for the patient — because the alternative is a single
 * class with conditionals in it, and a conditional that decides who may read a
 * street address is one forgotten branch away from being wrong. The rider
 * resource states the argument first and it holds here too: a hidden field is
 * one careless template away from being displayed; an absent field cannot be.
 *
 * WHAT IS DELIBERATELY NOT HERE, AND WHY EACH ONE IS OUT
 *
 *   recipient_name / recipient_phone / address_text / district / landmark
 *       The dispatcher's projection exists so a delivery can be PREPARED. A
 *       patient reading their own list does not need their own address read back
 *       to them, and this screen is the one most likely to be open on a shared
 *       handset or over a shoulder. `DeliveryPolicy` already draws this line by
 *       splitting `track` from `view` and giving the patient only `track`: "the
 *       patient waiting for this delivery may follow its progress without
 *       gaining the record itself, which names an address".
 *
 *   dispense_order_id / rider_id
 *       The order identifier belongs to the dispensing surface, which the
 *       patient reaches from their own order list; naming a rider tells a
 *       patient which member of a clinic's arrangement is carrying their
 *       medicine, which is a disclosure about the RIDER and serves nobody.
 *
 *   failure_reason
 *       THIS IS THE ONE THAT NEEDED AN ARGUMENT RATHER THAN A RULE. It is not
 *       clinical, and the patient is entitled to it — they are told it in full
 *       on `GET /v1/deliveries/{id}/tracking`, the page they reach by opening
 *       one delivery. It is out of the LIST because a list is read at a glance
 *       and often not by its owner: "refused" or "recipient_unreachable" against
 *       a row is a statement about a household, legible to anyone holding the
 *       phone, on a screen the patient opened to answer "where is my medicine".
 *       The one delivery a patient deliberately opens is a different act, and
 *       the tracking screen can put the clinic's telephone number beside the
 *       reason so it leads somewhere.
 *
 *   the events' `note` column
 *       Never read, here or in `tracking()`. It is operational free text, and
 *       free text is where clinical content escapes.
 *
 * THIS IS THE TRACKING SHAPE, AND `tracking()` IS BUILT FROM IT. The controller
 * renders this resource and adds `failure_reason` to it, so there is exactly one
 * implementation of "which columns of a delivery event a patient may see" rather
 * than two that can drift apart — and the diff between the list and the detail
 * is a single named field, visible in one place.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 * @see DeliveryPolicy — why `track` is not `view`
 *
 * @mixin Delivery
 */
class PatientDeliveryResource extends JsonResource
{
    /**
     * @return array{
     *     id: string,
     *     reference: string,
     *     status: string,
     *     assigned_at: ?string,
     *     delivered_at: ?string,
     *     milestones: list<array{status: string, occurred_at: ?string}>,
     * }
     */
    public function toArray(Request $request): array
    {
        // Every field here is deliberate. Adding one is a disclosure decision and
        // must be argued against the list above, not slipped in.
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'status' => $this->status->value,
            'assigned_at' => $this->assigned_at?->toIso8601String(),
            'delivered_at' => $this->delivered_at?->toIso8601String(),
            'milestones' => $this->milestones(),
        ];
    }

    /**
     * The status thread: what happened, and when.
     *
     * READS THE EAGER-LOADED RELATION WHERE THERE IS ONE. A listing renders this
     * for every row, and a resource that queried per row would turn one page of
     * a patient's deliveries into twenty-six round trips — so the listing loads
     * `events` and this method uses what it was given. The query is the fallback
     * for a single record, where there is nothing to batch.
     *
     * SORTED HERE RATHER THAN IN EITHER CALLER, so both paths produce the same
     * thread. `occurred_at` alone is not enough to order it: two transitions can
     * land in the same second, and the ULID tiebreak is monotonic where the
     * timestamp has run out of resolution.
     *
     * @return list<array{status: string, occurred_at: ?string}>
     */
    private function milestones(): array
    {
        /** @var Delivery $delivery */
        $delivery = $this->resource;

        $events = $delivery->relationLoaded('events')
            ? $delivery->events
            : $delivery->events()->get();

        /*
         * `array_values()` rather than the collection's own `->values()`, which is
         * already called below and is correct at runtime. PHPStan types
         * `Collection::all()` as `array<int, T>` and cannot see that `values()` has
         * just resequenced the keys, so the declared `list<>` return would not hold.
         * The native function it does understand, and reaching for it is cheaper than
         * a suppression -- the shape matters, because a non-list here serialises as a
         * JSON object keyed by index rather than an array, and a patient's delivery
         * thread would arrive at the portal as `{"0":{...}}`.
         */
        return array_values($events
            ->sortBy([['occurred_at', 'asc'], ['id', 'asc']])
            ->map(function (DeliveryEvent $event): array {
                $occurredAt = $event->getAttribute('occurred_at');

                // to_status and a timestamp. `note` is not read here and must not
                // become readable here: it is free text written by staff, and free
                // text is where clinical content escapes.
                return [
                    'status' => $event->to_status,
                    'occurred_at' => $occurredAt instanceof CarbonInterface
                        ? $occurredAt->toIso8601String()
                        : null,
                ];
            })
            ->values()
            ->all());
    }
}
