<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A password this account did not choose, and must replace before it acts.
     *
     * Clinic staff create patient accounts at the registration desk and read the
     * initial password aloud. For as long as that password stands, a second
     * person knows it -- which is not a theoretical problem here. The RBAC matrix
     * gives consent grant and withdrawal to the `patient` role and to nobody
     * else; every staff column is a dash. A member of staff who signs in with the
     * credential they issued can forge a consent decision, and the audit trail
     * records the patient as the actor, because as far as the system is concerned
     * the patient is who signed in.
     *
     * So the discharge is enforced rather than advised. While this column is
     * non-null, RequirePasswordChange refuses every request but the three that
     * let the patient look at their own account, replace the password, and leave.
     * AuthController::updatePassword() clears it in the same write that rotates
     * the remember token and ends every other session -- which is what evicts
     * anything the staff member opened with the credential they still know.
     *
     * NULLABLE, and null for almost everybody. Invited staff choose their own
     * password when they accept, so there is nothing for them to discharge; only
     * the staff-issued patient path ever writes this.
     *
     * timestamptz rather than a boolean. "Since when" is the question an
     * administrator asks about an account that has sat unclaimed for a month, and
     * a flag cannot answer it.
     *
     * @see docs/40-api/authentication-and-sessions.md
     * @see docs/50-security-compliance/rbac-matrix.md
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestampTz('password_change_required_at')->nullable()->after('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('password_change_required_at');
        });
    }
};
