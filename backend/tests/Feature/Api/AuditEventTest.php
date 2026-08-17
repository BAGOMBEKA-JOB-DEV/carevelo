<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The audit trail read
|--------------------------------------------------------------------------
|
| The evidence layer. When a clinic asks who read a record, when the PDPO asks
| what a patient consented to, or when a breach has to be scoped, this is what
| answers -- so the properties tested here are the ones that make it evidence
| rather than a log: it is complete, it is immutable, it is the clinic's own and
| nobody else's, and looking at it leaves a trace.
|
| @see docs/50-security-compliance/audit-logging.md
| @see docs/70-decisions/0006-audit-log-immutability.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function auditUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function auditStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * @param  array<string, mixed>  $metadata
 */
function auditRow(Tenant $tenant, string $action, array $metadata = []): AuditEvent
{
    return app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::create([
        'tenant_id' => $tenant->id,
        'actor_type' => 'system',
        'action' => $action,
        'subject_type' => 'Prescription',
        'subject_id' => (string) Str::ulid(),
        'occurred_at' => Date::now(),
        'metadata' => $metadata,
    ]));
}

it('shows a clinic its own trail and no other clinic\'s', function () {
    // Our tenants are frequently each other's local competitors, and an audit
    // trail names which patients were seen and by whom. A cross-tenant read
    // here is a notifiable breach affecting two controllers at once.
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $eventOfA = auditRow($tenantA, 'prescription.read');
    $eventOfB = auditRow($tenantB, 'prescription.read');

    $adminOfA = auditStaff($tenantA, ClinicalRole::ClinicAdmin);

    $ids = $this->actingAs($adminOfA)
        ->getJson(auditUrl($tenantA, '/api/v1/audit-events'))
        ->assertOk()
        ->json('data.*.id');

    expect($ids)->toContain($eventOfA->id)
        ->and($ids)->not->toContain($eventOfB->id);
});

it('exposes no way to write or delete an audit event', function () {
    // Nobody writes an audit event through the API -- events are written by the
    // system as a side effect of a domain operation -- and nothing at all
    // updates or deletes one. The database enforces the second half by grant;
    // this asserts the first half, that the surface does not exist to try.
    $methods = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (Illuminate\Routing\Route $route): bool => $route->uri() === 'api/v1/audit-events')
        ->flatMap(fn (Illuminate\Routing\Route $route): array => $route->methods())
        ->unique()
        ->sort()
        ->values()
        ->all();

    expect($methods)->toBe(['GET', 'HEAD']);

    $tenant = Tenant::factory()->create();
    $admin = auditStaff($tenant, ClinicalRole::ClinicAdmin);

    foreach (['postJson', 'patchJson', 'putJson', 'deleteJson'] as $verb) {
        $status = $this->actingAs($admin)
            ->{$verb}(auditUrl($tenant, '/api/v1/audit-events'))
            ->status();

        expect($status)->toBeIn([404, 405], "{$verb} on audit-events was routed");
    }
});

it('audits the reading of the audit log', function () {
    // Otherwise the log has a blind spot exactly where an insider would look:
    // someone checking whether their own access had been noticed would leave no
    // trace of having checked.
    $tenant = Tenant::factory()->create();
    $admin = auditStaff($tenant, ClinicalRole::ClinicAdmin);

    $before = app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::query()->count());

    $this->actingAs($admin)
        ->getJson(auditUrl($tenant, '/api/v1/audit-events?action=prescription.read'))
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($admin, $before) {
        expect(AuditEvent::query()->count())->toBe($before + 1);

        $event = AuditEvent::query()->where('action', 'audit_log.read')->firstOrFail();

        // WHO looked, and WHAT they went looking for. The filters are the
        // interesting part: the rows returned are reconstructible, the question
        // asked is not.
        expect($event->getAttribute('actor_id'))->toBe($admin->id)
            ->and($event->metadata['filters']['action'] ?? null)->toBe('prescription.read');
    });
});

it('never returns clinical content from an audit payload', function () {
    // The audit log is queried by administrators, exported for compliance and
    // retained for years. A log full of health data is a liability wearing the
    // costume of a control -- and because the table is append-only, nothing can
    // go back and clean a row written carelessly. So the read path is the last
    // line of defence, and it has to hold on rows that are already there.
    $tenant = Tenant::factory()->create();
    $admin = auditStaff($tenant, ClinicalRole::ClinicAdmin);

    $prescriptionId = (string) Str::ulid();

    auditRow($tenant, 'prescription.issued', [
        'diagnosis' => 'malaria',
        'reason' => 'Coartem course, confirmed malaria',
        'prescription_id' => $prescriptionId,
    ]);

    $response = $this->actingAs($admin)
        ->getJson(auditUrl($tenant, '/api/v1/audit-events'))
        ->assertOk();

    $body = strtolower(json_encode($response->json()) ?: '');

    foreach (['diagnosis', 'malaria', 'coartem'] as $term) {
        expect($body)->not->toContain($term, "The audit read leaked '{$term}'");
    }

    // And the identifier survives, which is the entire point: the event records
    // THAT a prescription was issued and WHICH one. Reading it requires the
    // record, under its own authorisation.
    expect($body)->toContain(strtolower($prescriptionId));
});

it('refuses the audit trail to a pharmacist', function () {
    // Other tenant roles read nothing. A clinician or pharmacist does not audit
    // the clinic, and the trail names which patients each colleague opened.
    $tenant = Tenant::factory()->create();
    $pharmacist = auditStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->getJson(auditUrl($tenant, '/api/v1/audit-events'))
        ->assertForbidden()
        ->assertJsonPath('code', 'forbidden');
});

it('refuses the audit trail to a deactivated administrator', function () {
    $tenant = Tenant::factory()->create();
    $admin = auditStaff($tenant, ClinicalRole::ClinicAdmin);

    app(Tenancy::class)->run($tenant->id, fn () => $admin->forceFill(['is_active' => false])->save());

    $this->actingAs($admin)
        ->getJson(auditUrl($tenant, '/api/v1/audit-events'))
        ->assertForbidden();
});
