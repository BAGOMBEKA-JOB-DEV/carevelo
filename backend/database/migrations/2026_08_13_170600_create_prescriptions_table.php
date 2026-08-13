<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prescriptions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('consultation_id');
            $table->ulid('clinician_id');
            $table->ulid('patient_id');

            // Snapshotted at issue, NOT joined at read time. If the clinician
            // later leaves the tenant or corrects their registration number,
            // the historical document must still show what was on it.
            $table->string('clinician_name_snapshot');
            $table->string('clinician_registration_snapshot');
            $table->string('registration_body_snapshot');

            $table->timestampTz('issued_at');
            $table->string('status')->default('issued');
            $table->ulid('supersedes_prescription_id')->nullable();
            $table->string('cancellation_reason')->nullable();

            $table->string('document_path')->nullable();
            $table->string('document_hash')->nullable();

            $table->timestamps();

            $table->foreign(['tenant_id', 'consultation_id'])
                ->references(['tenant_id', 'id'])->on('consultations');
            $table->foreign(['tenant_id', 'clinician_id'])
                ->references(['tenant_id', 'id'])->on('clinicians');

            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'patient_id']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::enableTenantIsolation('prescriptions');
    }

    public function down(): void
    {
        Schema::dropIfExists('prescriptions');
    }
};
