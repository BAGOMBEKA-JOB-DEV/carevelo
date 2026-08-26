<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * What Carevelo charged a clinic for the software, and what became of it.
         *
         * THIS IS NOT A PAYMENT_INTENT AND MUST NEVER BECOME ONE. The tables look
         * alike on purpose-blindness alone: both record an amount, an aggregator
         * reference and an outcome. Everything that matters about them differs.
         *
         *   payment_intents  -- a PATIENT pays a CLINIC. The merchant is the
         *                       clinic, the credentials are the clinic's own, the
         *                       money settles to the clinic, and Carevelo never
         *                       touches it. Tenant-scoped, RLS-isolated.
         *
         *   this table       -- a CLINIC pays CAREVELO. The merchant is Carevelo,
         *                       the credentials come from config, the money is
         *                       our own revenue. Platform-scoped.
         *
         * Running both through one table would put clinic money and Carevelo money
         * on one code path, and that is precisely how custody happens by accident:
         * one shared resolver, one shared account lookup, and a year later
         * somebody routes a patient's payment through the platform merchant
         * account to fix a reconciliation edge case. ADR-0003 is blunt about the
         * consequence -- NPS Act 2020 PSP and e-money categories at UGX 250m-10bn
         * of capital, which "would not inconvenience the company; it would end
         * it".
         *
         * ADR-0003 SS-Consequences permits exactly this and nothing more:
         * "Revenue is subscription-only". Carevelo is the merchant for its own
         * subscription and for nothing else.
         *
         * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
         * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
         */
        Schema::create('platform_subscription_charges', function (Blueprint $table) {
            $table->ulid('id')->primary();

            /*
             * WHO IS BEING BILLED -- not whose row this is.
             *
             * The distinction is the whole reason this table needs its own
             * policy rather than the usual one. Under enableTenantIsolation()
             * this column would make the row visible to that clinic, which is
             * how one clinic would come to read what Carevelo charges it, and
             * with a different tenant bound, nothing. Neither is wanted: the
             * commercial relationship between Carevelo and a clinic is the
             * PLATFORM's record.
             *
             * No foreign key to tenants. The charge is the evidence that a
             * clinic was billed, and it must survive the register row being
             * closed -- accounting outlives offboarding.
             */
            $table->ulid('tenant_id');

            // Copied from the tenant at the moment of charging rather than read
            // back through the relation. A clinic that upgrades in March must
            // not rewrite what February's charge says it was for.
            $table->string('plan');

            $table->bigInteger('amount_minor');
            $table->string('currency', 3)->default('UGX');

            /*
             * The period this charge buys. Dates, not instants: a billing period
             * is a calendar fact a human reads on an invoice, and Pesapal's
             * recurring API takes `start_date` and `end_date` as dd-MM-yyyy with
             * no time in them at all.
             */
            $table->date('period_starts_on');
            $table->date('period_ends_on');

            $table->string('status');

            /*
             * OUR reference, which Pesapal echoes back as
             * OrderMerchantReference. Unique so a retry of the same period
             * cannot produce two charges.
             */
            $table->string('merchant_reference')->unique();

            /*
             * PESAPAL'S id for the transaction, and the only field an inbound
             * notification is allowed to contribute.
             *
             * Nullable because a recurring charge exists at Pesapal before it
             * exists here: Pesapal initiates months two onward itself, and the
             * first this system hears of one is a RECURRING notification
             * carrying a tracking id it has never seen. Unique, so a replayed
             * notification cannot create a second charge for the same
             * transaction and extend a clinic's period twice.
             */
            $table->string('aggregator_tracking_id')->nullable()->unique();

            // Pesapal's confirmation code. An identifier for a support
            // conversation, never a fact we act on.
            $table->string('aggregator_reference')->nullable();

            // Machine code only. Pesapal's prose can quote a consumer key back
            // at you, and a message column is where that would come to rest.
            $table->string('failure_code')->nullable();

            $table->timestampTz('initiated_at');
            $table->timestampTz('resolved_at')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'period_ends_on']);
            $table->index('status');
        });

        /*
         * Declared platform-scoped, AND fenced by a policy. Both, deliberately.
         *
         * markPlatformScoped() answers the schema-conformance presumption: this
         * table is not a clinic's data, and saying so is a visible, reviewable
         * act in the diff that creates it -- the same bargain break_glass_grants
         * strikes.
         *
         * But break_glass_grants stops there, because a grant against a clinic is
         * something that clinic is entitled to see. These rows are not: they name
         * every clinic on the platform, the price each agreed and whether each has
         * paid. A clinic session that could read them would be reading its
         * competitors' commercial terms, so the invisibility is enforced by
         * PostgreSQL rather than by every future query remembering to be careful.
         *
         * The policy is the mirror of the tenant one: visible with NO tenant
         * bound, invisible and unwritable with ANY tenant bound. Disjoint in both
         * directions, exactly as audit_events' platform rows are.
         */
        Schema::markPlatformScoped(
            'platform_subscription_charges',
            "Carevelo's own subscription revenue from a clinic, not a clinic's ".
            'record of a patient payment; readable only with no tenant bound'
        );

        Schema::enablePlatformOnlyIsolation('platform_subscription_charges');
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_subscription_charges');
    }
};
