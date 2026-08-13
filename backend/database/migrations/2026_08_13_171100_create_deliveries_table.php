<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deliveries', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->string('reference');
            $table->ulid('dispense_order_id');
            $table->ulid('rider_id')->nullable();

            // Minimum necessary data. A delivery carries NO clinical field --
            // no diagnosis, no notes, no medicine names. The rider is the
            // least-trusted human actor and needs the least data.
            $table->string('recipient_name');
            $table->string('recipient_phone');
            $table->string('address_text');
            $table->string('district')->nullable();
            $table->string('landmark')->nullable();

            $table->string('status')->default('unassigned');
            $table->timestampTz('assigned_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->string('failure_reason')->nullable();

            $table->timestamps();

            $table->foreign(['tenant_id', 'dispense_order_id'])
                ->references(['tenant_id', 'id'])->on('dispense_orders');

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'reference']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'rider_id']);
        });

        Schema::enableTenantIsolation('deliveries');
    }

    public function down(): void
    {
        Schema::dropIfExists('deliveries');
    }
};
