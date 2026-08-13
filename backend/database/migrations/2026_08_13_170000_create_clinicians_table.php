<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clinicians', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('user_id');

            // Captured, never verified: Carevelo has no access to the UMDPC,
            // AHPC or Nurses & Midwives registers.
            $table->string('registration_body');
            $table->string('registration_number');
            $table->date('practising_licence_expires_at')->nullable();
            $table->string('specialty')->nullable();

            // The single most important flag in the system. A prescription may
            // only be issued by a clinician with this true AND a registration
            // number -- that is what keeps Carevelo a recorder, not an issuer.
            $table->boolean('can_prescribe')->default(false);

            $table->timestamps();

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'user_id']);
            $table->index(['tenant_id', 'can_prescribe']);
        });

        Schema::enableTenantIsolation('clinicians');
    }

    public function down(): void
    {
        Schema::dropIfExists('clinicians');
    }
};
