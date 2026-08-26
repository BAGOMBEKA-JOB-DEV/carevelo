<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * The subscription half of a tenant, which docs/20-domain/domain-model.md
         * has specified since the first draft -- "subscription: plan, status,
         * trial_ends_at" -- and which was never actually built. `status` and
         * `trial_ends_at` shipped; `plan` did not, so the register could say a
         * clinic was on trial and could not say what it was on trial OF.
         *
         * This closes that documented gap rather than inventing a concept.
         *
         * WHY THE PRICE IS ON THE TENANT AND NOT IN A PRICE LIST. Early plans in
         * this market are agreed in conversation (Business Plan SS-G), and a
         * clinic that negotiated a price keeps it. A tier alone would mean the
         * next change to a published price list silently re-priced every clinic
         * on that tier, retroactively, with nothing in the diff to show it. So
         * the tier says what the clinic gets and the amount says what THIS
         * clinic agreed to pay, and the two are allowed to disagree.
         *
         * NOT PATIENT MONEY. Nothing on this row concerns a patient's payment to
         * a clinic; it concerns Carevelo's own subscription revenue, which
         * ADR-0003 SS-Consequences names as the only revenue we take at all. The
         * two must not share a table, a code path or a merchant account.
         *
         * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
         */
        Schema::table('tenants', function (Blueprint $table) {
            // Nullable, and it stays nullable. A clinic in `provisioning` has
            // not agreed a plan yet, and forcing a default here would put every
            // half-onboarded clinic on a paid tier it never chose.
            $table->string('plan')->nullable();

            // Minor units, like every other amount in this system: whole
            // shillings times a hundred, so UGX 250,000 a month is 25,000,000.
            // bigInteger because an annual group plan in shillings comfortably
            // exceeds a 32-bit integer once multiplied by a hundred.
            //
            // Reads through the Money cast, which pairs it with the `currency`
            // column already on this table.
            $table->bigInteger('plan_price_minor')->nullable();

            /*
             * The end of the period the clinic has PAID FOR. The lapse test, and
             * the only thing the suspension sweep reads.
             *
             * timestampTz, not a date. A period boundary decides whether a
             * clinic's staff can sign in tomorrow morning, and a naive timestamp
             * would resolve in whatever timezone the database server happens to
             * be set to -- three hours of difference between a clinic that is
             * suspended and one that is not. Tenant declares the matching
             * offset-preserving date format; SchemaConformanceTest enforces the
             * pair.
             *
             * Nullable means "no paid period", which is not the same as lapsed:
             * a clinic on trial has a trial_ends_at and no paid period, and the
             * sweep reads both.
             */
            $table->timestampTz('current_period_ends_at')->nullable();

            // The sweep selects on it every hour, across every clinic.
            $table->index('current_period_ends_at');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropIndex(['current_period_ends_at']);
            $table->dropColumn(['plan', 'plan_price_minor', 'current_period_ends_at']);
        });
    }
};
