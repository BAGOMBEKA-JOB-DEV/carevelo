<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('substitutions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('dispense_order_id');
            $table->ulid('prescription_item_id');

            $table->string('proposed_medicine_name');
            $table->text('reason');

            $table->ulid('proposed_by');
            $table->timestampTz('proposed_at');

            // A substitution takes effect ONLY on clinician approval. It is
            // never an edit to the prescription and never a pharmacist's
            // unilateral decision. There is no auto-approval.
            $table->string('status')->default('pending');
            $table->ulid('decided_by')->nullable();
            $table->timestampTz('decided_at')->nullable();

            $table->timestamps();

            $table->foreign(['tenant_id', 'dispense_order_id'])
                ->references(['tenant_id', 'id'])->on('dispense_orders')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'prescription_item_id'])
                ->references(['tenant_id', 'id'])->on('prescription_items');

            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::enableTenantIsolation('substitutions');
    }

    public function down(): void
    {
        Schema::dropIfExists('substitutions');
    }
};
