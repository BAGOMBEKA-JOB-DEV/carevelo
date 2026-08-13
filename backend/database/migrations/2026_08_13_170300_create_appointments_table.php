<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('appointments', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->string('reference');

            $table->ulid('patient_id');
            $table->ulid('clinician_id');
            $table->ulid('service_id');

            $table->timestampTz('scheduled_start_at');
            $table->timestampTz('scheduled_end_at');
            $table->string('mode_booked');
            $table->string('payment_expectation')->default('prepaid');
            $table->string('status')->default('awaiting_payment');
            $table->string('cancellation_reason')->nullable();

            $table->timestamps();

            // Composite foreign keys make a cross-tenant reference
            // STRUCTURALLY IMPOSSIBLE rather than merely forbidden --
            // referential integrity does the work, and no future query can
            // undo it.
            $table->foreign(['tenant_id', 'patient_id'])
                ->references(['tenant_id', 'id'])->on('patients');
            $table->foreign(['tenant_id', 'clinician_id'])
                ->references(['tenant_id', 'id'])->on('clinicians');
            $table->foreign(['tenant_id', 'service_id'])
                ->references(['tenant_id', 'id'])->on('services');

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'reference']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'clinician_id', 'scheduled_start_at']);
        });

        Schema::enableTenantIsolation('appointments');
    }

    public function down(): void
    {
        Schema::dropIfExists('appointments');
    }
};
