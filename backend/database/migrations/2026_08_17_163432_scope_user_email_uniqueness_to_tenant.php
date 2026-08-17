<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An email address is unique WITHIN a clinic, not across the platform.
     *
     * `laravel new` ships a global unique index on users.email and it survived until
     * email sign-in needed it. Phone was already correct — `(tenant_id, phone)`, added
     * deliberately with the note that "the same person attending two clinics is two
     * patient records, which follows directly from tenant isolation." Email was not, and
     * the two rules contradicted each other.
     *
     * The consequence was concrete rather than theoretical: a clinician working at two
     * clinics could not hold an account at the second one, and a family sharing an
     * address would be refused. The class docblock on User says the opposite —
     * "someone working at two clinics has two accounts" — so the schema was enforcing
     * the reverse of the documented model.
     *
     * It also leaks. A global unique index means registration can be used to ask "does
     * this address already exist anywhere on the platform", which is a cross-tenant
     * question no request should be able to answer.
     *
     * @see docs/30-architecture/multi-tenancy.md
     * @see docs/40-api/authentication-and-sessions.md
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_email_unique');
            $table->unique(['tenant_id', 'email']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['tenant_id', 'email']);
            $table->unique('email');
        });
    }
};
