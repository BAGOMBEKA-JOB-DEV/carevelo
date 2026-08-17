<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_invitations', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            $table->string('phone');
            $table->string('name');

            // The role is fixed AT INVITATION and cannot be self-elevated by
            // the person accepting it.
            $table->string('role');

            // Hashed: the token is a bearer credential for as long as it lives.
            $table->string('token_hash')->unique();

            $table->ulid('invited_by')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->ulid('accepted_user_id')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'phone']);
        });

        Schema::enableTenantIsolation('staff_invitations');
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_invitations');
    }
};
