<?php

namespace App\Services\Billing;

use App\Services\Payments\ResolutionOutcome;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The idempotency record for inbound subscription notifications.
 *
 * The platform twin of WebhookDeliveryLedger, and separate from it because that
 * one writes to an RLS-isolated table keyed on tenant_id -- and a RECURRING
 * notification does not name a tenant. It could not: Pesapal sends three fields
 * and none of them is a clinic, and the field that eventually identifies one
 * arrives in the STATUS RESPONSE, after this claim has already been made.
 *
 * WHY THE CLAIM COMES FIRST, before the status call rather than after it. The
 * notification endpoint is unauthenticated and publicly reachable -- it has to
 * be, Pesapal signs nothing -- so replaying one notification a thousand times
 * would otherwise cost a thousand outbound requests. Claiming first bounds the
 * cost at one request per TRANSACTION rather than one per delivery, which is the
 * same bargain ADR-0012 SS-Consequences strikes for the patient path.
 *
 * The consequence is stated there too and holds here: a claim consumed by a
 * delivery we then fail to read is not retried, and the row stays `received` --
 * honestly, we heard and could not read. It is not a lost collection, because
 * Pesapal's recurring schedule and the clinic's next notification both come
 * round again, and because a notification was never the only path to the truth.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
final class SubscriptionNotificationLedger
{
    /**
     * Claim a notification for processing.
     *
     * Returns the record id, or null when this transaction has already been
     * seen.
     *
     * An INSERT rather than a read-then-write: `aggregator_tracking_id` is
     * unique in the database, and ON CONFLICT DO NOTHING settles a race between
     * two simultaneous deliveries without raising an error that would poison the
     * surrounding transaction.
     *
     * Runs with NO TENANT BOUND, and must. The table's policy makes it visible
     * only outside a tenant context, so a caller that had bound one would insert
     * a row it could not then read -- which is the policy working, and a reason
     * this is never called from inside Tenancy::run().
     */
    public function claim(string $trackingId): ?string
    {
        $id = (string) Str::ulid();

        $inserted = DB::table('platform_billing_notifications')->insertOrIgnore([
            'id' => $id,
            'aggregator_tracking_id' => $trackingId,
            'outcome' => ResolutionOutcome::Received->value,
            'received_at' => Date::now(),
        ]);

        return $inserted === 1 ? $id : null;
    }

    public function recordOutcome(string $id, ResolutionOutcome $outcome): void
    {
        DB::table('platform_billing_notifications')
            ->where('id', $id)
            ->update(['outcome' => $outcome->value]);
    }
}
