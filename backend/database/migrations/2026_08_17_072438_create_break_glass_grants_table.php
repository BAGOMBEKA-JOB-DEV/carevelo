<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * The only route by which a Carevelo operator reaches tenant clinical
         * data.
         *
         * Each clinic is the data CONTROLLER; we process on its instruction, so
         * reading its records without a recorded reason is processing without
         * one. Every grant is time-boxed, reason-recorded, tenant-notified and
         * audited, and a rising count means the SUPPORT TOOLING is inadequate
         * rather than that access is needed.
         *
         * @see docs/50-security-compliance/rbac-matrix.md
         */
        Schema::create('break_glass_grants', function (Blueprint $table) {
            $table->ulid('id')->primary();

            // The tenant whose data is being reached. Platform-scoped table:
            // these rows are deliberately visible to platform operators, and
            // surfaced to the affected tenant separately.
            $table->ulid('tenant_id');
            $table->ulid('operator_id');

            $table->text('reason');
            $table->string('scope');

            $table->timestampTz('granted_at');
            $table->timestampTz('expires_at');
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampTz('tenant_notified_at')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'granted_at']);
            $table->index(['operator_id', 'granted_at']);
        });

        Schema::markPlatformScoped(
            'break_glass_grants',
            'a cross-tenant control surface; visible to platform operators and notified to the affected tenant'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('break_glass_grants');
    }
};
