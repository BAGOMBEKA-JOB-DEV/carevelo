<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clinical_notes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('consultation_id');
            $table->ulid('author_id');

            $table->text('body');
            $table->string('note_type')->default('subjective');

            // Corrections are ADDENDA, never overwrites. A medical record that
            // can be silently rewritten is not a medical record.
            $table->ulid('supersedes_note_id')->nullable();

            $table->timestamps();

            $table->foreign(['tenant_id', 'consultation_id'])
                ->references(['tenant_id', 'id'])->on('consultations');

            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'consultation_id']);
        });

        Schema::enableTenantIsolation('clinical_notes');
    }

    public function down(): void
    {
        Schema::dropIfExists('clinical_notes');
    }
};
