<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The second factor's whole state on an account: a secret, a confirmation, a
     * high-water mark.
     *
     * ============================================================
     * THE SECOND FACTOR IS KEYED TO AN EMAIL ADDRESS AND A DEVICE
     * ============================================================
     *
     * There is no phone column here and there must never be one. This product had
     * a phone one-time-code sign-in and removed it deliberately --
     * 2026_08_17_171200_drop_otp_codes_table.php is that removal -- and the
     * account these columns protect is the one that can authorise a break-glass
     * grant into a clinic's patient records. An SMS second factor on that account
     * is one SIM swap away from being no second factor at all.
     *
     * What is stored is a shared secret that only the operator's authenticator
     * app holds the other copy of. The enrolment URI labels it with the
     * operator's EMAIL ADDRESS, which is the identifier a platform account signs
     * in with (App\Support\Auth\PlatformAccounts) and the only identifier it has.
     *
     * ============================================================
     * totp_secret_encrypted
     * ============================================================
     *
     * Named for what it holds so that nobody has to open the model to find out.
     * The column is written through Laravel's `encrypted` cast, so what lands in
     * PostgreSQL -- and therefore in every backup, every replica and every
     * database dump -- is ciphertext under APP_KEY. It is on User's `$hidden`
     * list, no resource serialises it, no audit event carries it, and
     * TotpAuthenticator deliberately exposes no public reader for a STORED
     * secret: the only secret that ever leaves the application is the one
     * beginEnrolment() has just generated, on its way to a single HTTP response.
     * That is the same write-only discipline the aggregator credentials are held
     * to, and for the same reason.
     *
     * TEXT rather than a sized string. A 20-byte secret is 32 base32 characters,
     * but the ciphertext is a base64 envelope carrying an IV, a MAC and the
     * serialised value, which is several hundred characters and would change
     * length if the cipher ever did. A varchar(255) here would fit today and
     * truncate on a cipher change -- silently destroying every enrolment.
     *
     * ============================================================
     * totp_confirmed_at, AND WHY A SECRET ALONE IS NOT AN ENROLMENT
     * ============================================================
     *
     * A secret that was generated and never proved against a real authenticator
     * is a secret nobody has. Treating its presence as enrolment would lock an
     * operator out with a code they cannot produce: the enrolment endpoint
     * generates and stores, and the account can only authenticate once a code
     * from the app has actually verified. TotpAuthenticator::isEnrolled() reads
     * both columns and neither alone.
     *
     * timestamptz rather than a boolean, so "since when" is answerable. An
     * operator whose enrolment predates a known compromise is a different
     * question from one who enrolled after it.
     *
     * ============================================================
     * totp_last_used_step IS THE REPLAY DEFENCE
     * ============================================================
     *
     * RFC 6238 section 5.2: the verifier MUST NOT accept a second authentication
     * for the same time step. A code is live for ninety seconds under the plus or
     * minus one step window this system permits, and ninety seconds is plenty for
     * a code read off a screen-share, a shoulder, or a phishing proxy sitting in
     * front of the operator.
     *
     * So the step a code belonged to is recorded, and advanced by a CONDITIONAL
     * UPDATE (TotpAuthenticator::advanceStep) which succeeds for exactly one of
     * two racing requests. bigInteger because the value is a unix timestamp
     * divided by thirty: it passes 2^31 in the year 6053 on a 32-bit integer
     * column, which is a long way off and is still the kind of thing that is free
     * to get right now and impossible to change later without a lock on users.
     *
     * NULLABLE, all three. Almost every account in this system is a patient or a
     * member of clinic staff with no second factor at all; only platform
     * operators are required to enrol, and the tenant-side enrolment surface the
     * specification RECOMMENDS for clinic_admin is not built yet.
     *
     * @see docs/40-api/authentication-and-sessions.md § Second factor
     * @see docs/50-security-compliance/threat-model.md § Spoofing
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('totp_secret_encrypted')->nullable()->after('password_change_required_at');
            $table->timestampTz('totp_confirmed_at')->nullable()->after('totp_secret_encrypted');
            $table->bigInteger('totp_last_used_step')->nullable()->after('totp_confirmed_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['totp_secret_encrypted', 'totp_confirmed_at', 'totp_last_used_step']);
        });
    }
};
