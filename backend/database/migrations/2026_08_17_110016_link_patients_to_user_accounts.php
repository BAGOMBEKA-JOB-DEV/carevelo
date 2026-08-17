<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which account, if any, may read this patient's record as their own.
     *
     * Until now there was no link at all between a User and a Patient, so "the
     * patient of this appointment" could not be expressed and every endpoint the
     * catalogue marks `P own` was closed to patients. It failed shut rather than
     * open, so nothing leaked -- but a patient could see nothing beyond
     * availability, and the join token could not be bound to a participant.
     *
     * NULLABLE, because most patient records exist before any account does.
     * Front desk registers a walk-in with a phone number and no password;
     * self-registration on the clinic portal is the other path
     * (H2 permits both). A record with no account is the normal state, not an
     * incomplete one.
     *
     * ONE ACCOUNT TO MANY PATIENTS, not one-to-one. A guardian holds their
     * children's records: the catalogue marks patient consents `P, guardian`,
     * the business plan requires guardian consent for minors under the DPPA's
     * special provisions, and this table already carries guardian_name,
     * guardian_phone and guardian_relationship. Modelling it as one-to-one now
     * would mean migrating live patient records later to undo it.
     *
     * The foreign key is COMPOSITE on (tenant_id, user_id). A plain
     * user_id reference would permit a patient record here to name an account at
     * another clinic -- users is platform-scoped and has no row-level security,
     * so RLS cannot refuse it the way it refuses a cross-tenant patient. The
     * composite key makes it structurally impossible instead of merely
     * forbidden, which is this schema's convention everywhere else.
     *
     * @see docs/70-decisions/0010-patient-account-link.md
     * @see docs/50-security-compliance/rbac-matrix.md
     */
    public function up(): void
    {
        // The composite foreign key below needs this as its target. users is
        // platform-scoped, so unlike the tenant-scoped tables it never got one.
        Schema::table('users', function (Blueprint $table) {
            $table->unique(['tenant_id', 'id']);
        });

        Schema::table('patients', function (Blueprint $table) {
            $table->ulid('user_id')->nullable()->after('tenant_id');

            // Every patient-scoped read resolves the caller's records through
            // this column, so it is on the hot path for the whole patient app.
            $table->index(['tenant_id', 'user_id']);
        });

        /*
         * Raw, because Blueprint cannot express the column list on SET NULL and
         * the difference is not cosmetic.
         *
         * A composite ON DELETE SET NULL nulls EVERY referencing column, which
         * here includes tenant_id -- and patients.tenant_id is NOT NULL. So the
         * plain form does not do what it reads as: deleting a user with a linked
         * patient would fail on a not-null violation from a column nobody asked
         * to change, and the record's tenant is the last thing that may move,
         * since RLS is keyed on it.
         *
         * SET NULL (user_id) releases the account and leaves the record where it
         * is. The medical record outlives the login, and the clinic may be
         * legally obliged to retain it. Requires PostgreSQL 15 or newer.
         */
        DB::statement('
            alter table patients
            add constraint patients_tenant_id_user_id_foreign
            foreign key (tenant_id, user_id)
            references users (tenant_id, id)
            on delete set null (user_id)
        ');
    }

    public function down(): void
    {
        Schema::table('patients', function (Blueprint $table) {
            $table->dropForeign(['tenant_id', 'user_id']);
            $table->dropIndex(['tenant_id', 'user_id']);
            $table->dropColumn('user_id');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['tenant_id', 'id']);
        });
    }
};
