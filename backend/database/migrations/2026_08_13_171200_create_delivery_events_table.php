<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('delivery_id');

            $table->string('from_status')->nullable();
            $table->string('to_status');
            $table->ulid('actor_id')->nullable();
            $table->timestampTz('occurred_at');
            $table->string('note')->nullable();

            $table->foreign(['tenant_id', 'delivery_id'])
                ->references(['tenant_id', 'id'])->on('deliveries')->cascadeOnDelete();

            $table->index(['tenant_id', 'delivery_id']);
        });

        Schema::enableTenantIsolation('delivery_events');
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_events');
    }
};
