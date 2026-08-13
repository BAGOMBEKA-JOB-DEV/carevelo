<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->ulid('id')->primary();

            // Immutable after provisioning: it appears in patient-facing URLs,
            // in the aggregator's webhook configuration and on printed
            // materials. A clinic that rebrands gets a custom domain instead.
            $table->string('slug')->unique();
            $table->string('subdomain')->unique();
            $table->string('custom_domain')->nullable()->unique();

            $table->string('legal_name');
            $table->string('trading_name')->nullable();

            $table->string('primary_colour')->nullable();
            $table->string('secondary_colour')->nullable();
            $table->string('logo_path')->nullable();

            $table->string('contact_phone')->nullable();
            $table->string('contact_email')->nullable();
            $table->string('physical_address')->nullable();
            $table->string('district')->nullable();

            // Stored as the clinic's own attestation and explicitly NOT
            // verified: Carevelo has no access to the UMDPC or NDA registers.
            // Never present these as verified in any UI.
            $table->string('umdpc_facility_reference')->nullable();
            $table->string('nda_licence_reference')->nullable();

            $table->string('status')->default('provisioning');
            $table->string('timezone')->default('Africa/Kampala');
            $table->string('currency', 3)->default('UGX');
            $table->timestamp('trial_ends_at')->nullable();

            $table->timestamps();

            $table->index('status');
        });

        // The tenant register itself is platform-scoped: it has no tenant_id
        // and is not subject to RLS. Declared explicitly so the schema
        // conformance test can tell "deliberately platform-scoped" apart from
        // "someone forgot".
        Schema::markPlatformScoped('tenants', 'the tenant register itself');
    }

    public function down(): void
    {
        Schema::dropIfExists('tenants');
    }
};
