<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Permission for one participant to join one consultation, once, soon.
     *
     * The video provider cannot enforce any of that. It knows a room identifier
     * and nothing else -- deliberately, since it must never receive a patient
     * identity or a clinical detail -- so short-lived, single-use and
     * participant-bound are properties this table has to supply.
     *
     * @see docs/30-architecture/realtime-and-video.md
     * @see docs/70-decisions/0004-video-provider-selection.md
     */
    public function up(): void
    {
        Schema::create('join_tokens', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            // Composite, so a token cannot name an appointment at another clinic
            // even if RLS were somehow bypassed.
            $table->ulid('appointment_id');
            $table->foreign(['tenant_id', 'appointment_id'])
                ->references(['tenant_id', 'id'])
                ->on('appointments')
                ->cascadeOnDelete();

            // WHOSE token this is. The patient of the appointment or its
            // clinician, and it works for that account alone -- a token that
            // admits whoever holds it is a link that can be forwarded into a
            // consultation.
            $table->ulid('user_id');

            // Hashed, exactly as OtpCode hashes its code and for the same
            // reason: for the minutes it lives this row IS the credential, and a
            // leaked table must not hand over live ones.
            $table->string('token_hash');

            // The opaque room the provider is told about. apt-{ulid} and nothing
            // more: no name, no reason for the consultation, no patient id.
            $table->string('room_name');

            $table->timestampTz('expires_at');

            // Single use, and consumed rather than deleted so a replay is
            // distinguishable from an expiry when someone asks why a patient
            // could not join.
            $table->timestampTz('consumed_at')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'appointment_id', 'user_id']);
            $table->index('expires_at');
        });

        Schema::enableTenantIsolation('join_tokens');
    }

    public function down(): void
    {
        Schema::dropIfExists('join_tokens');
    }
};
