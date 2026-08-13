<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prescription_items', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('prescription_id');

            $table->string('medicine_name');
            $table->string('form')->nullable();
            $table->string('strength')->nullable();
            $table->unsignedInteger('quantity');
            $table->string('unit')->nullable();
            $table->text('directions');

            // Controlled items are flagged for in-person handling and are
            // EXCLUDED from the delivery flow entirely, per NDPA Act Cap 206.
            // There is deliberately no override.
            $table->boolean('is_controlled')->default(false);

            $table->timestamps();

            $table->foreign(['tenant_id', 'prescription_id'])
                ->references(['tenant_id', 'id'])->on('prescriptions')->cascadeOnDelete();

            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'prescription_id']);
        });

        Schema::enableTenantIsolation('prescription_items');
    }

    public function down(): void
    {
        Schema::dropIfExists('prescription_items');
    }
};
