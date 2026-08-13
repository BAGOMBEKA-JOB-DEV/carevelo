<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outbound_notifications', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            $table->string('channel');
            $table->string('recipient');
            $table->string('template_key');

            // NO clinical content ever reaches this table. SMS transits the
            // mobile operator and lands on a lock screen; a WebSocket frame
            // fans out to every subscriber on a role channel. Bodies are
            // rendered from templates that are themselves tested against a
            // prohibited-content list.
            $table->text('body');

            $table->string('status')->default('queued');
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->string('failure_reason')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'status']);
        });

        Schema::enableTenantIsolation('outbound_notifications');
    }

    public function down(): void
    {
        Schema::dropIfExists('outbound_notifications');
    }
};
