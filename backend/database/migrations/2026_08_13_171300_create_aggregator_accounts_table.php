<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aggregator_accounts', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->ulid('tenant_id');

            $table->string('provider');

            // The CLINIC'S OWN credentials. Encrypted at rest, write-only
            // through the API, never returned in any response and never
            // written to any log including exception traces.
            //
            // Carevelo has no merchant account of its own: there is no
            // platform account for funds to reach.
            $table->text('public_key')->nullable();
            $table->text('secret_key')->nullable();
            $table->text('webhook_secret')->nullable();
            $table->string('merchant_reference')->nullable();

            $table->string('environment')->default('sandbox');
            $table->string('status')->default('unconfigured');
            $table->timestampTz('last_verified_at')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'id']);
            $table->unique(['tenant_id', 'provider']);
        });

        Schema::enableTenantIsolation('aggregator_accounts');
    }

    public function down(): void
    {
        Schema::dropIfExists('aggregator_accounts');
    }
};
