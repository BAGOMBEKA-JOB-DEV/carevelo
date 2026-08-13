<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consent_records', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('patient_id');

            $table->string('consent_type');

            // The exact wording shown, pinned. Under DPPA 2019 consent must be
            // DEMONSTRABLE -- reconstructing what someone actually agreed to,
            // months later, is the entire purpose.
            $table->string('policy_version');
            $table->string('policy_text_hash');

            $table->string('action');
            $table->string('granted_by')->default('patient');
            $table->string('guardian_name')->nullable();
            $table->string('guardian_relationship')->nullable();

            $table->timestamp('occurred_at');
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent')->nullable();

            $table->foreign(['tenant_id', 'patient_id'])
                ->references(['tenant_id', 'id'])->on('patients')->cascadeOnDelete();

            $table->index(['tenant_id', 'patient_id', 'consent_type']);
        });

        Schema::enableTenantIsolation('consent_records');
    }

    public function down(): void
    {
        Schema::dropIfExists('consent_records');
    }
};
