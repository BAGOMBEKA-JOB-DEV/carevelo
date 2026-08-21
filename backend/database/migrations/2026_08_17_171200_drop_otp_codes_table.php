<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Phone one-time codes are gone. Drop the table they lived in.
     *
     * Patients sign in with an email address and a password, like staff. The
     * controller, the model, the issuer and the notification template were all
     * removed in the same change, so nothing reads or writes this table any more.
     *
     * The create-migration was deleted rather than kept, which is correct for a
     * decision this final -- but on its own it converges nothing. A machine that
     * has already migrated keeps `otp_codes` for ever: the migrator only runs
     * what it has not run, and the file recording the run is gone. So a fresh
     * database would have no table and every existing one would, and the
     * schema-conformance test derives its expectations from the live schema,
     * which means the two would disagree about what the schema even is.
     *
     * This is the migration that makes them agree.
     *
     * DROP TABLE takes the row-level security policy with it -- a policy is owned
     * by its table, so `Schema::enableTenantIsolation('otp_codes')` leaves nothing
     * behind to clean up. Nor was the table ever declared platform-scoped, so
     * there is no table comment to unset either. The one thing the drop does NOT
     * reach is the rate-limiter buckets AuthThrottle wrote under
     * `tenant:*:auth:otp-request:*`, and it does not need to: those live in the
     * cache store with a fifteen-minute decay and are gone within the quarter
     * hour.
     *
     * Every row it destroys was a hashed credential with a five-minute life, so
     * there is nothing here worth migrating and nothing a clinic could be asked
     * to keep.
     *
     * @see docs/40-api/authentication-and-sessions.md
     */
    public function up(): void
    {
        Schema::dropIfExists('otp_codes');
    }

    /**
     * Deliberately empty.
     *
     * Recreating the table would produce something worse than nothing: a table
     * carrying row-level security and no reader, no writer and no model, which
     * reads to the next person as a feature that exists rather than one that was
     * removed. The code that gave the columns their meaning is not coming back on
     * a `migrate:rollback`.
     *
     * Rolling back and forward again is still safe -- dropIfExists is idempotent.
     */
    public function down(): void
    {
        //
    }
};
