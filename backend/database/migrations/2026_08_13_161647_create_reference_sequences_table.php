<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reference_sequences', function (Blueprint $table) {
            $table->ulid('tenant_id');
            $table->string('prefix', 8);
            $table->string('period', 4);
            $table->unsignedInteger('next_value')->default(1);

            $table->primary(['tenant_id', 'prefix', 'period']);
        });

        Schema::enableTenantIsolation('reference_sequences');
    }

    public function down(): void
    {
        Schema::dropIfExists('reference_sequences');
    }
};
