<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('working_hours', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            // 0 = Sunday, matching Carbon's dayOfWeek.
            $table->unsignedTinyInteger('day_of_week');
            $table->time('opens_at');
            $table->time('closes_at');
            $table->boolean('is_closed')->default(false);

            $table->timestamps();

            $table->unique(['tenant_id', 'day_of_week']);
        });

        Schema::enableTenantIsolation('working_hours');
    }

    public function down(): void
    {
        Schema::dropIfExists('working_hours');
    }
};
