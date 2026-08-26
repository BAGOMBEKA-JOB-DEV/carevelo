<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * The idempotency record for inbound subscription notifications.
         *
         * The platform twin of webhook_deliveries, and a separate table rather
         * than a `tenant_id is null` row in that one, because webhook_deliveries
         * is RLS-isolated on tenant_id: a platform notification could not be
         * written to it without a tenant bound, and binding one would be a lie --
         * we do not know which clinic a RECURRING notification concerns until
         * Pesapal tells us, and Pesapal only tells us in the STATUS RESPONSE.
         *
         * WHY THE CLAIM HAPPENS BEFORE THE STATUS CALL. ADR-0012 SS-Consequences:
         * the endpoint is unauthenticated and publicly reachable, so an
         * attacker replaying one notification a thousand times would otherwise
         * cost a thousand outbound requests to Pesapal. Claiming first bounds it
         * at one request per TRANSACTION rather than one per delivery.
         *
         * The tracking id is the only key, with no provider column beside it.
         * There is exactly one platform merchant account and it is at Pesapal;
         * a second provider for platform revenue would be a decision with its
         * own ADR, not a column somebody adds.
         *
         * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
         */
        Schema::create('platform_billing_notifications', function (Blueprint $table) {
            $table->ulid('id')->primary();

            // Pesapal mints this. Unique is the whole point of the table: the
            // insert either claims the delivery or tells us somebody already
            // has, in one statement, with no read-then-write race in between.
            $table->string('aggregator_tracking_id')->unique();

            // `received` until we know better -- which is honest, and stays
            // honest if Pesapal is unreachable the moment we ask.
            $table->string('outcome');

            $table->timestampTz('received_at');
        });

        /*
         * Same pairing as the charges table: declared out of the tenant-scoping
         * presumption, and then fenced so a tenant session cannot see or write a
         * row. Nothing here belongs to a clinic -- a tracking id and an outcome
         * about Carevelo's own collection -- and the endpoint that writes it runs
         * with no tenant bound at all.
         */
        Schema::markPlatformScoped(
            'platform_billing_notifications',
            'idempotency for notifications about Carevelo\'s own subscription '.
            'collections; readable only with no tenant bound'
        );

        Schema::enablePlatformOnlyIsolation('platform_billing_notifications');
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_billing_notifications');
    }
};
