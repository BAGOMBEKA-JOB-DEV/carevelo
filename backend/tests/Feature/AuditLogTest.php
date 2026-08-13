<?php

use App\Audit\AuditLog;
use App\Models\AuditEvent;
use App\Models\Tenant;
use App\Tenancy\Tenancy;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Mandatory test 6 -- append-only audit log
|--------------------------------------------------------------------------
|
| An audit log an attacker can edit answers none of the questions it exists for.
| The realistic compromise scenario is code execution in our own application, so
| immutability is enforced by database GRANTS rather than by application code.
|
| See docs/70-decisions/0006-audit-log-immutability.md
|
*/

it('records an event inside the tenant', function () {
    $tenant = Tenant::factory()->create();

    $event = app(Tenancy::class)->run($tenant->id, fn () => app(AuditLog::class)->record(
        'prescription.issued',
        subjectType: 'Prescription',
        subjectId: '01JABCDEF',
    ));

    expect($event->tenant_id)->toBe($tenant->id)
        ->and($event->action)->toBe('prescription.issued');
});

it('cannot be updated through the model', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        $event = app(AuditLog::class)->record('consent.granted');
        $event->action = 'consent.withdrawn';
        $event->save();
    });
})->throws(LogicException::class, 'append-only');

it('cannot be deleted through the model', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        app(AuditLog::class)->record('consent.granted')->delete();
    });
})->throws(LogicException::class, 'append-only');

it('cannot be updated even by raw sql, because the grant is revoked', function () {
    // The control. Application-level guards are a nicety; this is what holds
    // when an attacker is executing arbitrary code as the application.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        app(AuditLog::class)->record('consent.granted');

        DB::statement("UPDATE audit_events SET action = 'tampered'");
    });
})->throws(QueryException::class);

it('cannot be deleted even by raw sql', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        app(AuditLog::class)->record('consent.granted');

        DB::statement('DELETE FROM audit_events');
    });
})->throws(QueryException::class);

it('scrubs anything clinical or secret from metadata', function () {
    // Defence in depth against a careless caller. The audit log records THAT
    // something happened to WHICH record, never what the record said.
    $tenant = Tenant::factory()->create();

    $event = app(Tenancy::class)->run($tenant->id, fn () => app(AuditLog::class)->record(
        'prescription.issued',
        metadata: [
            'prescription_id' => '01JABC',
            'diagnosis' => 'malaria',
            'medicine_name' => 'Amoxicillin 500mg',
            'phone' => '+256772123456',
            'secret_key' => 'sk_live_xyz',
        ],
    ));

    expect($event->metadata)->toBe(['prescription_id' => '01JABC']);
});

it('keeps one tenant audit trail invisible to another', function () {
    $tenancy = app(Tenancy::class);
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $tenancy->run($tenantA->id, fn () => app(AuditLog::class)->record('consent.granted'));

    $visible = $tenancy->run($tenantB->id, fn () => AuditEvent::query()->count());

    expect($visible)->toBe(0);
});
