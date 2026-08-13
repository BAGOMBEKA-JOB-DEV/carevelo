<?php

namespace App\Services\Payments;

use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The idempotency record for inbound deliveries.
 *
 * Aggregators retry, and duplicate deliveries are routine rather than
 * exceptional. Without this, two deliveries of one success callback could
 * confirm an appointment twice and double-count a day's takings in the
 * reconciliation view.
 *
 * @see docs/40-api/webhooks.md
 */
final class WebhookDeliveryLedger
{
    /**
     * Claim a delivery for processing.
     *
     * Returns the record id, or null when this event has already been seen.
     *
     * The claim is an INSERT rather than a read-then-write: `(tenant_id,
     * provider, provider_event_id)` is unique in the database, and ON CONFLICT
     * DO NOTHING settles a race between two simultaneous deliveries without
     * raising an error that would poison the surrounding transaction.
     */
    public function claim(string $tenantId, string $provider, string $eventId): ?string
    {
        $id = (string) Str::ulid();

        $inserted = DB::table('webhook_deliveries')->insertOrIgnore([
            'id' => $id,
            'tenant_id' => $tenantId,
            'provider' => $provider,
            'provider_event_id' => $eventId,
            'outcome' => ResolutionOutcome::Received->value,
            'received_at' => Date::now(),
        ]);

        return $inserted === 1 ? $id : null;
    }

    public function recordOutcome(string $id, ResolutionOutcome $outcome): void
    {
        DB::table('webhook_deliveries')
            ->where('id', $id)
            ->update(['outcome' => $outcome->value]);
    }
}
