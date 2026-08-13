<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            $table->string('provider');

            // Aggregators retry; duplicate deliveries are routine rather than
            // exceptional. Without this uniqueness, two deliveries of a success
            // callback could confirm an appointment twice.
            $table->string('provider_event_id');

            $table->string('outcome');
            $table->timestampTz('received_at');

            $table->unique(['tenant_id', 'provider', 'provider_event_id']);
        });

        Schema::enableTenantIsolation('webhook_deliveries');
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_deliveries');
    }
};
