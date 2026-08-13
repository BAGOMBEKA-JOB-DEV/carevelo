<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dispense_items', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('dispense_order_id');
            $table->ulid('prescription_item_id');

            // What was actually handed over, which may differ from what was
            // prescribed. Both facts must survive independently -- that is why
            // this table exists separately from prescription_items.
            $table->string('medicine_name_dispensed');
            $table->unsignedInteger('quantity_dispensed')->default(0);
            $table->bigInteger('unit_price_minor')->default(0);
            $table->string('currency', 3)->default('UGX');
            $table->ulid('substitution_id')->nullable();
            $table->boolean('is_fulfilled')->default(true);
            $table->string('unfulfilled_reason')->nullable();

            $table->timestamps();

            $table->foreign(['tenant_id', 'dispense_order_id'])
                ->references(['tenant_id', 'id'])->on('dispense_orders')->cascadeOnDelete();

            $table->unique(['tenant_id', 'id']);
        });

        Schema::enableTenantIsolation('dispense_items');
    }

    public function down(): void
    {
        Schema::dropIfExists('dispense_items');
    }
};
