<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Chat inside a consultation.
     *
     * MODELLED ON clinical_notes, DELIBERATELY, AND NOT ON A MESSAGING TABLE.
     * Two documents already promise this table exists -- the threat model and
     * the integrations document both say a video failure "falls back to chat,
     * which we serve ourselves" -- and until now a video outage fell back to a
     * notice and a telephone number. Now that the SFU is our own, the outage
     * those documents describe is one we operate ourselves, so the fallback has
     * to be something we operate ourselves too.
     *
     * WHAT A ROW HERE IS. Text a clinician types during an encounter is a
     * clinical instruction; it is indistinguishable in kind from a note, and
     * the patient's half is the history they gave. The "consultations are not
     * recorded" non-goal is about MEDIA -- there is no store of audio or video
     * and there must not be -- and it says nothing about text.
     * docs/30-architecture/realtime-and-video.md states the positive rule:
     * "Chat messages within a consultation are clinical data, stored in-tenant,
     * subject to RLS, and never sent by SMS."
     *
     * So this table gets the treatment a clinical record gets: tenant
     * isolation enforced by PostgreSQL, the composite foreign key that makes a
     * cross-tenant parent impossible, a place in the offboarding export, and
     * append-only semantics in the model above it.
     *
     * RETENTION. The clinic is the controller and the medical-record retention
     * obligation is the clinic's, defaulting to seven years
     * (docs/50-security-compliance/data-retention-and-deletion.md). There is no
     * retention job in this application yet -- for ANY clinical table, notes
     * included -- so "messages inherit retention" today means this table is on
     * the list the job will read when it is written, not that anything expires.
     * Stated plainly rather than implied, because a table that looks covered
     * and is not is worse than one obviously uncovered.
     *
     * @see docs/30-architecture/realtime-and-video.md
     * @see docs/50-security-compliance/threat-model.md denial of service
     * @see docs/30-architecture/integrations.md failure handling
     */
    public function up(): void
    {
        Schema::create('consultation_messages', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');
            $table->ulid('consultation_id');

            // The user account that typed it -- a clinician's or a patient's.
            // Not a Clinician id: the patient side has no Clinician record, and
            // one column that means two things depending on the row is how a
            // transcript becomes unreadable.
            $table->ulid('author_id');

            /*
             * WHICH SIDE SPOKE, denormalised on purpose.
             *
             * author_id alone is enough for a live screen, which knows who is
             * signed in. It is NOT enough for the record: an export read years
             * later, or under break-glass, has to be interpretable without
             * joining to accounts that may since have been deactivated or
             * merged. A transcript where you cannot tell the clinician's lines
             * from the patient's is not a clinical record.
             *
             * Derived server-side from the authorisation decision, never
             * accepted from the client -- see StoreConsultationMessageRequest,
             * which has no field for it.
             */
            $table->string('author_role');

            // Special-category health data under DPPA 2019, exactly as
            // clinical_notes.body is. It is read back by the messages endpoint
            // and by the export, and by nothing else -- not a notification, not
            // a log line, not an audit event, not a broadcast frame.
            $table->text('body');

            $table->timestamps();

            /*
             * The composite key, matching clinical_notes.
             *
             * A plain foreign key on consultation_id alone would let a row name
             * a parent in another clinic -- row-level security filters what a
             * SESSION can see, and says nothing about what a foreign key may
             * reference. Referencing (tenant_id, consultation_id) makes a
             * cross-tenant message unrepresentable in the schema rather than
             * merely unreachable through the API.
             */
            $table->foreign(['tenant_id', 'consultation_id'])
                ->references(['tenant_id', 'id'])->on('consultations');

            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'consultation_id']);
        });

        Schema::enableTenantIsolation('consultation_messages');
    }

    public function down(): void
    {
        Schema::dropIfExists('consultation_messages');
    }
};
