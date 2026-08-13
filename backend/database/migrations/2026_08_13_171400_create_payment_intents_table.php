<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * A RECORD of a payment attempt -- not a payment.
         *
         * The name is deliberate. Carevelo does not effect payments and holds
         * no funds: the patient pays the aggregator, the aggregator settles
         * DIRECTLY to the clinic's own account, and this table records that an
         * attempt was made and what the aggregator said about it.
         *
         * Note what is absent, permanently: there is no wallet, balance,
         * float, escrow, payout or settlement column here or anywhere else.
         * Their absence is a compliance control -- custody would trigger the
         * NPS Act 2020 PSP / e-money categories and their UGX 250m-10bn
         * capital requirements.
         *
         * @see docs/50-security-compliance/payments-regulatory-boundary.md
         */
        Schema::create('payment_intents', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->string('reference');

            $table->string('payable_type');
            $table->ulid('payable_id');

            $table->bigInteger('amount_minor');
            $table->string('currency', 3)->default('UGX');
            $table->string('method');
            $table->string('aggregator')->nullable();
            $table->string('aggregator_reference')->nullable();

            // Prevents a retried request becoming a second charge. Unique per
            // tenant, retained 24 hours -- comfortably longer than any
            // mobile-money resolution window.
            $table->string('idempotency_key');
            $table->string('request_fingerprint')->nullable();
            $table->jsonb('stored_response')->nullable();

            $table->string('status')->default('initiated');
            $table->timestampTz('initiated_at');
            $table->timestampTz('resolved_at')->nullable();

            // timed_out is NOT final: a reconciliation poll can still move it
            // to succeeded on a late mobile-money confirmation. Treating a
            // timeout as definitive failure produces the worst available
            // outcome -- a patient charged for a cancelled booking.
            $table->timestampTz('next_poll_at')->nullable();
            $table->unsignedSmallInteger('poll_attempts')->default(0);

            $table->string('failure_code')->nullable();
            $table->text('failure_message')->nullable();
            $table->jsonb('raw_callback_payload')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'reference']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'aggregator_reference']);
            $table->index(['status', 'next_poll_at']);
        });

        Schema::enableTenantIsolation('payment_intents');
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_intents');
    }
};
