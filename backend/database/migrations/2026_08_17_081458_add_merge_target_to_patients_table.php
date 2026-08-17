<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where a duplicate registration's history went.
     *
     * Front desk registers the same person twice -- a walk-in whose number was
     * mistyped, a patient who gave a second handset. Merging moves the clinical
     * history onto one record, and this column is what remains on the other.
     *
     * The duplicate is NOT deleted. PatientPolicy::delete() returns false for
     * everyone, because the clinic may be legally obliged to retain the medical
     * record and because a row that once had a consent decision attached to it
     * has to stay explicable. So the loser of a merge survives as a pointer.
     *
     * Without this column a merged duplicate is indistinguishable from a live
     * patient, which is the dangerous outcome: a clinician opens it, finds no
     * history for someone who has plenty, and treats them as new.
     *
     * No status change. `merged` is deliberately not a PatientStatus -- the
     * documented state machine moves through CONSENT decisions, and a merge is a
     * record-keeping correction, not a consent event.
     *
     * @see docs/10-product/prd-h2-patient-registration-consent.md
     * @see docs/20-domain/state-machines.md
     */
    public function up(): void
    {
        Schema::table('patients', function (Blueprint $table) {
            // Self-referential and within the tenant by construction: RLS makes
            // a patient from another clinic unreachable, so no merge can cross
            // the isolation boundary even if a caller supplies a foreign id.
            $table->ulid('merged_into_patient_id')->nullable()->after('status');

            $table->foreign('merged_into_patient_id')
                ->references('id')
                ->on('patients')
                ->nullOnDelete();

            // Every patient listing filters on this, so it earns an index.
            $table->index('merged_into_patient_id');
        });
    }

    public function down(): void
    {
        Schema::table('patients', function (Blueprint $table) {
            $table->dropForeign(['merged_into_patient_id']);
            $table->dropIndex(['merged_into_patient_id']);
            $table->dropColumn('merged_into_patient_id');
        });
    }
};
