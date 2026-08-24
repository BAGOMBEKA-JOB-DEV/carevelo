<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The three columns Pesapal's flow needs that Flutterwave's did not.
 *
 * Flutterwave is verified-then-read: the client starts the collection against
 * the aggregator itself and every inbound message carries OUR reference, so
 * nothing extra had to be stored. Pesapal inverts that. We submit the order
 * server-side, Pesapal mints its own identifier for it, and the inbound
 * notification carries ONLY that identifier -- no status, no amount, no
 * signature. So the identifier has to be stored, or an IPN cannot be tied to
 * the attempt it concerns.
 *
 * None of these is money, a balance or an instruction to move funds. They are
 * three strings that let us ask the clinic's own aggregator a question about
 * the clinic's own collection.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('aggregator_accounts', function (Blueprint $table) {
            // Pesapal's GUID for the notification URL we registered. Registered
            // ONCE per account and reused: RegisterIPN is not idempotent, and a
            // clinic accumulating a new registration on every collection would
            // eventually have Pesapal notifying a list of dead URLs.
            //
            // Not a credential -- it identifies a URL, not an identity -- so it
            // is not encrypted. It is still never returned by the API, because
            // nothing about a clinic's aggregator configuration is.
            $table->string('ipn_id')->nullable();
        });

        Schema::table('payment_intents', function (Blueprint $table) {
            // Pesapal's own identifier for the order, from SubmitOrderRequest.
            // The ONLY thing its notification carries, and therefore the only
            // way to resolve one back to an attempt.
            $table->string('aggregator_tracking_id')->nullable();

            // Pesapal's hosted payment page for this order. Stored so a patient
            // who closes the tab can be sent back to the same page rather than
            // having a second order submitted against their name.
            $table->text('redirect_url')->nullable();
        });

        // Tenant-first, because every lookup is already inside a tenant's
        // row-level security context and the tracking id alone is never a
        // sufficient key: it arrives on an unauthenticated endpoint, and
        // matching it outside a tenant would be a cross-tenant read performed
        // by an anonymous caller.
        Schema::table('payment_intents', function (Blueprint $table) {
            $table->index(['tenant_id', 'aggregator_tracking_id'], 'payment_intents_tenant_tracking_index');
        });
    }

    public function down(): void
    {
        Schema::table('payment_intents', function (Blueprint $table) {
            $table->dropIndex('payment_intents_tenant_tracking_index');
            $table->dropColumn(['aggregator_tracking_id', 'redirect_url']);
        });

        Schema::table('aggregator_accounts', function (Blueprint $table) {
            $table->dropColumn('ipn_id');
        });
    }
};
