<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * The way back in when the authenticator is gone.
         *
         * ============================================================
         * WHY A MANDATORY SECOND FACTOR NEEDS THESE
         * ============================================================
         *
         * TOTP is required of a platform operator, and a required second factor
         * with no recovery path is an outage waiting for a dropped phone -- at,
         * by the nature of the job, the moment somebody is trying to reach a
         * clinic that cannot work. The documented recovery is out of band and
         * administrative (docs/40-api/authentication-and-sessions.md § Second
         * factor); these are the same act performed in advance, by the operator
         * themselves, so that recovering does not require finding a colleague.
         *
         * Note what recovery is NOT: it is not a code sent to a handset. There
         * is no SMS anywhere on this surface, and reintroducing one here --
         * "just for recovery" -- would put SIM swap back in front of the account
         * that can grant break-glass access to a clinic's patient records.
         *
         * ============================================================
         * code_hash IS NOT A CODE
         * ============================================================
         *
         * It is a SHA-256 digest of one, and there is no path back. An operator
         * who loses the sheet they were shown at enrolment does not recover it
         * from here, from a backup, or from us -- they enrol again. A database
         * dump therefore hands an attacker digests of ten eighty-bit values they
         * cannot guess, rather than ten standing bypasses of the second factor.
         *
         * SHA-256 and not bcrypt, which is a deliberate departure from how
         * passwords are stored and is argued in full in
         * App\Support\Totp\RecoveryCodes: the input is eighty bits from
         * random_bytes, so there is no dictionary for a work factor to slow
         * down, and verifying one code means comparing it against every unspent
         * code on the account -- ten bcrypt comparisons at cost 12 is seconds of
         * CPU handed to anyone who posts a wrong code at the sign-in path.
         *
         * char(64) because a SHA-256 hex digest is exactly 64 characters,
         * always. A fixed width says so to the next reader and refuses anything
         * that is not one.
         *
         * ============================================================
         * used_at: SPENT, NOT DELETED
         * ============================================================
         *
         * Single use is the property that stops a recovery code being a static
         * password with extra ceremony, and it is enforced by a conditional
         * UPDATE on this column so that two requests racing on the same code
         * produce exactly one winner.
         *
         * The row STAYS. A deleted row and a row that never existed look
         * identical to anyone reading this table afterwards, and this is the
         * mechanism by which a second factor is bypassed -- "which code was
         * spent, and when" is exactly the question a reviewer asks. The one
         * place rows are destroyed is a re-enrolment, where the whole set is
         * revoked because the secret it was minted against no longer exists.
         *
         * ============================================================
         * WHY THIS TABLE IS PLATFORM-SCOPED
         * ============================================================
         *
         * It hangs off users, which is itself platform-scoped: authentication
         * has to find an account before there is a session to resolve a tenant
         * from. A platform operator has no tenant at all -- tenant_id is null by
         * definition -- so a tenant_id column here could only ever be null and a
         * row-level security policy keyed on the bound tenant would make signing
         * in impossible. Scoping is by user_id, which is the only scope these
         * rows have.
         *
         * @see docs/40-api/authentication-and-sessions.md § Second factor
         */
        Schema::create('totp_recovery_codes', function (Blueprint $table) {
            $table->ulid('id')->primary();

            // Cascade: an account that is gone cannot be recovered into, and
            // leaving orphaned digests behind would only grow the number of
            // live-looking credentials in a dump.
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();

            $table->char('code_hash', 64);

            $table->timestampTz('used_at')->nullable();

            $table->timestamps();

            // The one query this table serves on the hot path: every unspent
            // code for one account, compared in constant time.
            $table->index(['user_id', 'used_at']);
        });

        Schema::markPlatformScoped(
            'totp_recovery_codes',
            'second-factor recovery for an account that may have no tenant at all; '
            .'scoped by user_id, and users is itself platform-scoped because '
            .'authentication must find the account before a tenant resolves'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('totp_recovery_codes');
    }
};
