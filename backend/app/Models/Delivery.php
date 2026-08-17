<?php

namespace App\Models;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\Concerns\BelongsToTenant;
use Database\Factories\DeliveryFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * Transport of a dispensed order to the patient.
 *
 * CARRIES NO CLINICAL DATA. No diagnosis, no notes, no prescription detail.
 * The rider is the least-trusted human actor in the system and needs the least
 * data: a delivery address, a name, a contact number and a package reference.
 *
 * That minimisation is enforced at the API serialisation layer by a distinct
 * resource class -- not by hiding fields in the UI, because a hidden field is
 * one careless template away from being displayed.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 *
 * @property string $id
 * @property string $reference
 * @property DeliveryStatus $status
 * @property ?string $rider_id
 * @property string $recipient_name
 * @property string $recipient_phone
 * @property string $address_text
 * @property ?string $district
 * @property ?string $landmark
 * @property ?string $failure_reason
 * @property string $dispense_order_id
 * @property ?Carbon $assigned_at
 * @property ?Carbon $delivered_at
 * @property-read ?DispenseOrder $dispenseOrder
 */
class Delivery extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<DeliveryFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'reference', 'dispense_order_id', 'rider_id', 'recipient_name',
        'recipient_phone', 'address_text', 'district', 'landmark',
        'status', 'assigned_at', 'delivered_at', 'failure_reason',
    ];

    /** Reasons a delivery may fail. Free text alone cannot be reported on. */
    public const FAILURE_REASONS = [
        'recipient_unreachable',
        'address_incorrect',
        'refused',
        'rider_unable_to_complete',
    ];

    /**
     * assigned_at, delivered_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * The instant stored then depends on how the database server happens to be
     * configured. What shifts here is the delivery timeline the patient is shown.
     *
     * Columns declared without a timezone ignore the offset, so created_at and
     * updated_at are unaffected.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DeliveryStatus::class,
            'assigned_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    /**
     * The dispensed order being delivered.
     *
     * Used to reach the patient identifier when broadcasting -- that decides
     * WHERE a frame goes, and is deliberately not part of what it says.
     *
     * @return BelongsTo<DispenseOrder, $this>
     */
    public function dispenseOrder(): BelongsTo
    {
        return $this->belongsTo(DispenseOrder::class);
    }

    /** @return HasMany<DeliveryEvent, $this> */
    public function events(): HasMany
    {
        return $this->hasMany(DeliveryEvent::class);
    }

    /**
     * Create a delivery for a dispensed order.
     *
     * Refuses outright where the order contains a controlled item: those are
     * flagged for in-person handling under NDPA Act Cap 206 and never enter
     * the delivery flow.
     */
    /**
     * @param  array{reference: string, recipient_name: string, recipient_phone: string, address_text: string, district?: ?string, landmark?: ?string}  $recipient
     */
    public static function createFor(DispenseOrder $order, array $recipient): self
    {
        if (! $order->mayBeDelivered()) {
            throw new IllegalTransition(
                'This order contains a controlled item and cannot be delivered. '
                .'Controlled substances require in-person handling under the NDPA Act.'
            );
        }

        return static::create([
            'reference' => $recipient['reference'],
            'dispense_order_id' => $order->id,
            'recipient_name' => $recipient['recipient_name'],
            'recipient_phone' => $recipient['recipient_phone'],
            'address_text' => $recipient['address_text'],
            'district' => $recipient['district'] ?? null,
            'landmark' => $recipient['landmark'] ?? null,
            'status' => DeliveryStatus::Unassigned,
        ]);
    }

    public function assignTo(string $riderId, ?string $actorId = null): void
    {
        $this->transitionTo(DeliveryStatus::Assigned, $actorId);

        $this->rider_id = $riderId;
        $this->assigned_at = Date::now();
        $this->save();
    }

    public function fail(string $reason, ?string $actorId = null): void
    {
        if (! in_array($reason, self::FAILURE_REASONS, true)) {
            throw new IllegalTransition(
                'Delivery failure reason must be one of: '.implode(', ', self::FAILURE_REASONS)
            );
        }

        $this->failure_reason = $reason;
        $this->transitionTo(DeliveryStatus::Failed, $actorId);
    }

    /** Every transition writes an event -- this is the patient's status thread. */
    public function transitionTo(DeliveryStatus $status, ?string $actorId = null): void
    {
        $from = $this->status;
        $from->assertCanTransitionTo($status);

        $this->status = $status;

        if ($status === DeliveryStatus::Delivered) {
            $this->delivered_at = Date::now();
        }

        $this->save();

        $this->events()->create([
            'from_status' => $from->value,
            'to_status' => $status->value,
            'actor_id' => $actorId,
            'occurred_at' => Date::now(),
        ]);
    }
}
