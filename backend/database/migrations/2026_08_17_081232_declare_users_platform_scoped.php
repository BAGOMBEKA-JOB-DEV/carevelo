<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Record WHY users carries tenant_id and yet has no row-level security.
     *
     * The exemption is real and load-bearing: authentication has to find the
     * account before there is a session to resolve a tenant from, so a policy
     * keyed on the bound tenant would make signing in impossible. Scoping is
     * supplied in PHP instead, by App\Support\Auth\Accounts, which never queries
     * users without a tenant predicate.
     *
     * It was previously exempted by a hard-coded list inside the
     * schema-conformance test. That list and the schema could disagree without
     * anything noticing -- and did, which is how break_glass_grants shipped
     * declaring itself platform-scoped while the test still read it as a table
     * missing RLS. The declaration belongs next to the table.
     *
     * Comment only. No column, index or policy changes.
     *
     * @see docs/30-architecture/multi-tenancy.md
     * @see docs/40-api/authentication-and-sessions.md
     */
    public function up(): void
    {
        Schema::markPlatformScoped(
            'users',
            'authentication must find the account before a tenant resolves; '
            .'scoped in PHP by App\Support\Auth\Accounts, never queried unscoped'
        );
    }

    public function down(): void
    {
        DB::statement('COMMENT ON TABLE users IS NULL');
    }
};
