<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Nullable: platform users (Carevelo staff) belong to no tenant.
            // Clinic staff always belong to exactly one -- there is no
            // cross-tenant staff identity, so someone working at two clinics
            // has two accounts.
            $table->ulid('tenant_id')->nullable()->after('id');

            // The phone is the primary credential: most Ugandan clinic staff
            // have a working phone and no reliably checked email address.
            $table->string('phone')->nullable()->after('email');
            $table->timestamp('phone_verified_at')->nullable()->after('email_verified_at');

            $table->boolean('is_active')->default(true);

            $table->index(['tenant_id', 'is_active']);
            $table->unique(['tenant_id', 'phone']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['tenant_id', 'phone']);
            $table->dropIndex(['tenant_id', 'is_active']);
            $table->dropColumn(['tenant_id', 'phone', 'phone_verified_at', 'is_active']);
        });
    }
};
