<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('services', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedSmallInteger('duration_minutes')->default(30);

            // Integer minor units plus explicit currency. Never a float.
            $table->bigInteger('price_minor')->default(0);
            $table->string('currency', 3)->default('UGX');

            // Voice and chat are first-class modes, not degraded fallbacks: a
            // patient on a poor connection must be able to CHOOSE voice.
            $table->jsonb('modes')->nullable();
            $table->jsonb('eligible_roles')->nullable();
            $table->boolean('is_active')->default(true);

            $table->timestamps();

            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'is_active']);
        });

        Schema::enableTenantIsolation('services');
    }

    public function down(): void
    {
        Schema::dropIfExists('services');
    }
};
