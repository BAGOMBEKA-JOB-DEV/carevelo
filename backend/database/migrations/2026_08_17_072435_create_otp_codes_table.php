<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('otp_codes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            // E.164. The phone is the primary credential: most Ugandan clinic
            // staff and nearly all patients have a working phone and no
            // reliably checked email address.
            $table->string('phone');

            // Hashed, never stored in the clear. An OTP is a credential for the
            // five minutes it lives, and a leaked table must not hand over
            // active codes.
            $table->string('code_hash');

            $table->string('purpose')->default('sign_in');
            $table->timestampTz('expires_at');

            // Single use. A consumed code is kept (not deleted) so a replay is
            // distinguishable from an expiry in the audit trail.
            $table->timestampTz('consumed_at')->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->string('ip_address', 45)->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'phone', 'purpose']);
            $table->index('expires_at');
        });

        Schema::enableTenantIsolation('otp_codes');
    }

    public function down(): void
    {
        Schema::dropIfExists('otp_codes');
    }
};
