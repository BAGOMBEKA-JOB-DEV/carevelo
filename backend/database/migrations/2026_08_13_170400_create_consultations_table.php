<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consultations', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('appointment_id');
            $table->ulid('patient_id');
            $table->ulid('clinician_id');

            $table->timestampTz('started_at');
            $table->timestampTz('ended_at')->nullable();

            // What ACTUALLY happened, which may differ from what was booked.
            // A video call that fell back to voice is recorded as voice: the
            // truthful record matters clinically, and it is the only honest
            // measure of what patients on Ugandan mobile data experience.
            $table->string('mode_used');
            $table->string('outcome')->nullable();

            $table->timestamps();

            $table->foreign(['tenant_id', 'appointment_id'])
                ->references(['tenant_id', 'id'])->on('appointments');

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'appointment_id']);
            $table->index(['tenant_id', 'patient_id']);
        });

        Schema::enableTenantIsolation('consultations');
    }

    public function down(): void
    {
        Schema::dropIfExists('consultations');
    }
};
