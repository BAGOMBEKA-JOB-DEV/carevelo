<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dispense_orders', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->string('reference');
            $table->ulid('prescription_id');
            $table->ulid('patient_id');

            // Dispensing is always recorded against a NAMED pharmacist of the
            // tenant. Carevelo never dispenses.
            $table->ulid('pharmacist_id')->nullable();

            $table->string('fulfilment')->nullable();
            $table->bigInteger('subtotal_minor')->default(0);
            $table->bigInteger('delivery_fee_minor')->default(0);
            $table->bigInteger('total_minor')->default(0);
            $table->string('currency', 3)->default('UGX');

            $table->string('status')->default('received');
            $table->string('rejection_reason')->nullable();
            $table->timestampTz('dispensed_at')->nullable();

            $table->timestamps();

            // Same tenant as its prescription. Always.
            $table->foreign(['tenant_id', 'prescription_id'])
                ->references(['tenant_id', 'id'])->on('prescriptions');

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'reference']);
            $table->unique(['tenant_id', 'prescription_id']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::enableTenantIsolation('dispense_orders');
    }

    public function down(): void
    {
        Schema::dropIfExists('dispense_orders');
    }
};
