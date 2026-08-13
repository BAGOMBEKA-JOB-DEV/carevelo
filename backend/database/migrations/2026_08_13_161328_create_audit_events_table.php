<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_events', function (Blueprint $table) {
            $table->ulid('id')->primary();

            // Nullable: platform-level events (tenant provisioning, break-glass
            // grants) have no tenant. Those rows live outside tenant RLS.
            $table->ulid('tenant_id')->nullable();

            $table->string('actor_type');
            $table->ulid('actor_id')->nullable();
            $table->string('actor_role')->nullable();

            $table->string('action');
            $table->string('subject_type')->nullable();
            $table->ulid('subject_id')->nullable();

            $table->timestamp('occurred_at');
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent')->nullable();
            $table->ulid('request_id')->nullable();

            // Identifiers and outcomes only. NEVER clinical content, patient
            // names, contact details or secrets: the audit log is queried by
            // administrators, exported for compliance and retained longer than
            // most data. A log full of health data is a liability wearing the
            // costume of a control.
            $table->jsonb('metadata')->nullable();

            $table->index(['tenant_id', 'occurred_at']);
            $table->index(['tenant_id', 'subject_type', 'subject_id']);
            $table->index(['tenant_id', 'actor_id']);
            $table->index('action');
        });

        Schema::enableTenantIsolationWithPlatformRows('audit_events');

        // Append-only, enforced by grants rather than convention. An attacker
        // with application-level code execution -- the realistic compromise
        // scenario -- cannot cover their tracks.
        Schema::makeAppendOnly('audit_events');
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_events');
    }
};
