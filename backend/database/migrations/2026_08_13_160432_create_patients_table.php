<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patients', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('given_name');
            $table->string('family_name');

            // Normalised to E.164 on write. Unique within the tenant, never
            // globally: the same person attending two clinics is two patient
            // records, which follows directly from tenant isolation.
            $table->string('phone');
            $table->string('email')->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('sex')->nullable();

            // Optional in perpetuity. Requiring a NIN excludes patients, and
            // exclusion is a worse outcome than unverified identity.
            $table->string('national_id_number')->nullable();

            $table->string('address')->nullable();
            $table->string('district')->nullable();

            $table->string('guardian_name')->nullable();
            $table->string('guardian_phone')->nullable();
            $table->string('guardian_relationship')->nullable();

            $table->string('status')->default('pending_consent');
            $table->timestamp('phone_verified_at')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'phone']);
            $table->index(['tenant_id', 'status']);

            // Composite unique on (tenant_id, id) so other tenant-scoped tables
            // can carry a composite foreign key back to it. That makes a
            // cross-tenant reference structurally impossible rather than merely
            // forbidden — referential integrity does the work, and no future
            // query can undo it.
            $table->unique(['tenant_id', 'id']);
        });

        Schema::enableTenantIsolation('patients');
    }

    public function down(): void
    {
        Schema::dropIfExists('patients');
    }
};
