<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Events\Dispatchable;
use InvalidArgumentException;

/**
 * A hint that something changed. Never the thing that changed.
 *
 * RULE 4, and the reason the payload rule is affordable: the socket says
 * SOMETHING CHANGED, the API says WHAT IT IS NOW, under full authorisation.
 * A dropped or duplicated frame degrades freshness, never correctness, and any
 * later refresh reconciles it. This matters most for payment state — a client
 * must never treat a frame as confirmation that a patient paid.
 *
 * RULE 3 is enforced by construction rather than by care. A subclass holds
 * PROMOTED READONLY STRINGS ONLY, never a model, so there is no attribute bag
 * for a diagnosis, a medicine name or a patient's name to arrive in. That also
 * makes the event safe to queue: with no model to re-hydrate there is nothing
 * for a worker to fetch, and therefore nothing it could fetch without tenant
 * context. Do NOT add SerializesModels here.
 *
 * ShouldBroadcast rather than ShouldBroadcastNow, deliberately: Reverb being
 * unreachable must degrade the clinic to polling, never fail the dispensing
 * action that produced the event.
 *
 * ShouldRescue is the other half of that promise, and it is not decoration.
 * "Queued" means "handed to the queue connection", and under the sync driver —
 * which is what local development runs, and what a small deployment can be
 * talked into — the queue connection executes the job INLINE, inside the
 * request that dispatched it. The publish to Reverb is an HTTP call, so a
 * Reverb that is down or simply not started turns a refused connection into a
 * 500 on the dispense, the payment attestation or the delivery update that
 * raised the event. That is exactly the outcome the paragraph above forbids,
 * arrived at from the queue side rather than the broadcast side. Rescued, the
 * failure is reported and the domain action completes; the clinic falls back to
 * polling and reconciles on the next refresh, which the payload rule already
 * guarantees is safe — a frame is a hint, never the fact.
 *
 * @see docs/30-architecture/realtime-broadcasting.md
 */
abstract class TenantBroadcast implements ShouldBroadcast, ShouldRescue
{
    use Dispatchable;
    use InteractsWithSockets;

    public function __construct(public readonly string $tenantId) {}

    /**
     * Always private, always tenant-prefixed, always built by TenantChannel.
     *
     * @return list<PrivateChannel>
     */
    abstract public function broadcastOn(): array;

    /**
     * Identifiers and state. Nothing a person could read as clinical content.
     *
     * @return array<string, string|null>
     */
    abstract public function broadcastWith(): array;

    /** Past-tense domain event name, in the ubiquitous language. */
    abstract public function broadcastAs(): string;

    /**
     * The tenant that owns a record, refused if it has none.
     *
     * A broadcast without a tenant cannot be addressed to a channel, so it must
     * not be constructible.
     */
    protected static function tenantOf(Model $model): string
    {
        return self::stringAttribute($model, 'tenant_id');
    }

    protected static function keyOf(Model $model): string
    {
        return self::stringAttribute($model, $model->getKeyName());
    }

    /**
     * Read one identifier-shaped attribute as a string.
     *
     * Everything on the wire passes through here, which is the second half of
     * the payload guarantee: values are scalars read attribute by attribute,
     * never a serialised model.
     */
    protected static function stringAttribute(Model $model, string $attribute): string
    {
        $value = $model->getAttribute($attribute);

        if (! is_string($value) || $value === '') {
            throw new InvalidArgumentException(sprintf(
                'Cannot broadcast %s: %s is missing.',
                $model::class,
                $attribute,
            ));
        }

        return $value;
    }
}
