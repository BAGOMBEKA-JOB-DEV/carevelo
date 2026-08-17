<?php

use App\Models\AuditEvent;
use App\Models\BreakGlassGrant;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Platform\BreakGlassAccess;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Break-glass
|--------------------------------------------------------------------------
|
| The only route by which a Carevelo operator reaches tenant clinical data, and
| therefore the control that has to hold under every one of its failure modes.
| Four things are required and each is tested by its ABSENCE:
|
|   a recorded REASON, a stated SCOPE, a TIME BOX, and TENANT NOTIFICATION.
|
| Plus the one that makes the rest reviewable: every access writes an
| AuditEvent, into the CLINIC'S OWN trail.
|
| See docs/50-security-compliance/rbac-matrix.md break-glass section
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function breakGlassUrl(string $path = '/api/v1/platform/break-glass'): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function operator(ClinicalRole $role = ClinicalRole::PlatformSupport): User
{
    $user = User::factory()->create(['tenant_id' => null]);
    $user->assignRole($role->value);

    return $user;
}

/** @return array<string, string> */
function grantRequest(Tenant $tenant, string $scope = 'consultation'): array
{
    return [
        'tenant_id' => $tenant->id,
        'reason' => 'Ticket CV-4821: the clinic cannot open a record and has asked us to look.',
        'scope' => $scope,
        'expires_at' => Date::now()->addHours(2)->toIso8601String(),
    ];
}

/** Audit events belonging to a clinic are only visible inside its context. */
function tenantAuditActions(Tenant $tenant): array
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn () => AuditEvent::query()->pluck('action')->all(),
    );
}

it('records a reason, a scope, a time box and the tenant notification', function () {
    $tenant = Tenant::factory()->create();

    $response = $this->actingAs(operator())
        ->postJson(breakGlassUrl(), grantRequest($tenant))
        ->assertCreated();

    expect($response->json('data.reason'))->toContain('CV-4821')
        ->and($response->json('data.scope'))->toBe('consultation')
        ->and($response->json('data.expires_at'))->not->toBeNull()
        // The clinic is the controller and has a right to know when its
        // processor read its records. An unnotified grant is not a grant.
        ->and($response->json('data.tenant_notified_at'))->not->toBeNull()
        ->and($response->json('data.permits_access_now'))->toBeTrue();

    $grant = BreakGlassGrant::query()->findOrFail($response->json('data.id'));

    expect($grant->wasTenantNotified())->toBeTrue()
        ->and($grant->expires_at->isFuture())->toBeTrue();
});

it('writes the notification into the clinic\'s own audit trail', function () {
    // Not a side channel the clinic has to be told to check: it lands in the
    // trail the clinic's administrator already reads.
    $tenant = Tenant::factory()->create();

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), grantRequest($tenant))
        ->assertCreated();

    expect(tenantAuditActions($tenant))->toContain('break_glass.tenant_notified');
});

it('rejects a grant with no reason', function () {
    $tenant = Tenant::factory()->create();

    $payload = grantRequest($tenant);
    unset($payload['reason']);

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), $payload)
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonValidationErrors('reason');

    expect(BreakGlassGrant::query()->count())->toBe(0);
});

it('rejects a reason too thin for a reviewer to act on', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), [...grantRequest($tenant), 'reason' => 'debug'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');
});

it('rejects a grant with no scope', function () {
    $tenant = Tenant::factory()->create();

    $payload = grantRequest($tenant);
    unset($payload['scope']);

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('scope');
});

it('rejects a scope outside the closed list', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), [...grantRequest($tenant), 'scope' => 'everything'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('scope');
});

it('rejects a grant with no time box', function () {
    $tenant = Tenant::factory()->create();

    $payload = grantRequest($tenant);
    unset($payload['expires_at']);

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('expires_at');
});

it('rejects a time box longer than the maximum', function () {
    // Standing access wearing an exception's costume. A longer investigation
    // issues a second grant, which is notified and audited again.
    $tenant = Tenant::factory()->create();

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), [
            ...grantRequest($tenant),
            'expires_at' => Date::now()->addHours(BreakGlassGrant::MAX_DURATION_HOURS + 1)->toIso8601String(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('expires_at');
});

it('rejects a time box that has already elapsed', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAs(operator())
        ->postJson(breakGlassUrl(), [
            ...grantRequest($tenant),
            'expires_at' => Date::now()->subHour()->toIso8601String(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('expires_at');
});

it('refuses a grant request from a clinic role', function () {
    // Break-glass is a platform control. A clinic administrator asking for one
    // is asking for cross-tenant reach.
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    $this->actingAs($admin)
        ->postJson(breakGlassUrl(), grantRequest($tenant))
        ->assertForbidden();
});

it('permits access under a live grant and audits every one', function () {
    $tenant = Tenant::factory()->create();
    $operator = operator();

    $patient = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());

    $grant = BreakGlassGrant::factory()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    $access = app(BreakGlassAccess::class);

    // Twice, because the audit event is per ACCESS and not per grant: a grant
    // read once and a grant read forty times are different facts.
    $first = $access->underGrant(
        $operator,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->findOrFail($patient->id),
        $patient->id,
    );

    $access->underGrant($operator, $tenant->id, 'patient_record', fn () => null, $patient->id);

    expect($first->id)->toBe($patient->id)
        ->and($grant->fresh()?->permits('patient_record'))->toBeTrue();

    $accesses = collect(tenantAuditActions($tenant))
        ->filter(fn (string $action) => $action === 'break_glass.accessed');

    expect($accesses)->toHaveCount(2);
});

it('records no clinical content in the access audit event', function () {
    // The audit log records THAT something happened to WHICH record, never what
    // the record said. It is retained permanently for break-glass events, so a
    // leak here is a leak that outlives everything else.
    $tenant = Tenant::factory()->create();
    $operator = operator();

    $patient = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create([
        'given_name' => 'Namuli',
        'family_name' => 'Nakiwala',
    ]));

    BreakGlassGrant::factory()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    app(BreakGlassAccess::class)->underGrant(
        $operator,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->findOrFail($patient->id),
        $patient->id,
    );

    $events = app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::query()
        ->where('action', 'break_glass.accessed')
        ->get()
        ->map(fn (AuditEvent $event) => $event->metadata)
        ->all());

    $encoded = strtolower((string) json_encode($events));

    foreach (['namuli', 'nakiwala', 'diagnosis', 'medicine', 'reason'] as $term) {
        expect($encoded)->not->toContain($term, "The break-glass audit event leaked '{$term}'");
    }

    expect($events[0])->toHaveKey('record_id')
        ->and($events[0]['record_id'])->toBe($patient->id);
});

it('refuses access under an expired grant', function () {
    // The time box is the control. A grant that expires mid-investigation stops
    // working mid-investigation, because it is re-checked on every access.
    $tenant = Tenant::factory()->create();
    $operator = operator();

    BreakGlassGrant::factory()
        ->expired()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $operator,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->get(),
    ))->toThrow(AuthorizationException::class);
});

it('refuses access under a revoked grant', function () {
    $tenant = Tenant::factory()->create();
    $operator = operator();

    BreakGlassGrant::factory()
        ->revoked()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $operator,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->get(),
    ))->toThrow(AuthorizationException::class);
});

it('refuses access under a grant the clinic was never told about', function () {
    $tenant = Tenant::factory()->create();
    $operator = operator();

    BreakGlassGrant::factory()
        ->unnotified()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $operator,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->get(),
    ))->toThrow(AuthorizationException::class);
});

it('refuses access outside the granted scope', function () {
    // A grant for a prescription is not a grant for the whole record. A stated
    // scope that nothing compares against is decoration.
    $tenant = Tenant::factory()->create();
    $operator = operator();

    BreakGlassGrant::factory()
        ->forScope('prescription')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $operator,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->get(),
    ))->toThrow(AuthorizationException::class);
});

it('refuses access to a clinic the grant does not name', function () {
    $tenant = Tenant::factory()->create();
    $other = Tenant::factory()->create();
    $operator = operator();

    BreakGlassGrant::factory()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $operator->id]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $operator,
        $other->id,
        'patient_record',
        fn () => Patient::query()->get(),
    ))->toThrow(AuthorizationException::class);
});

it('refuses access under another operator\'s grant', function () {
    $tenant = Tenant::factory()->create();
    $granted = operator();
    $borrower = operator();

    BreakGlassGrant::factory()
        ->forScope('patient_record')
        ->create(['tenant_id' => $tenant->id, 'operator_id' => $granted->id]);

    expect(fn () => app(BreakGlassAccess::class)->underGrant(
        $borrower,
        $tenant->id,
        'patient_record',
        fn () => Patient::query()->get(),
    ))->toThrow(AuthorizationException::class);
});

it('refuses to widen a scope or extend a time box on an issued grant', function () {
    // Both are new grants, each notified to the clinic and audited again. An
    // editable grant is an audit trail that can be rewritten after the fact.
    $grant = BreakGlassGrant::factory()->create();

    expect(function () use ($grant) {
        $grant->scope = 'audit_trail';
        $grant->save();
    })->toThrow(LogicException::class);

    expect(function () use ($grant) {
        $grant->expires_at = Date::now()->addDays(30);
        $grant->save();
    })->toThrow(LogicException::class);
});

it('lists the grant register for a platform reviewer', function () {
    $tenant = Tenant::factory()->create();
    $grant = BreakGlassGrant::factory()->create(['tenant_id' => $tenant->id]);

    $response = $this->actingAs(operator(ClinicalRole::PlatformAdmin))
        ->getJson(breakGlassUrl())
        ->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())->toContain($grant->id);
});

it('shows a clinic the grants against itself and no others', function () {
    // The controller's right to know, served through the same register.
    $tenant = Tenant::factory()->create();
    $other = Tenant::factory()->create();

    $own = BreakGlassGrant::factory()->create(['tenant_id' => $tenant->id]);
    $foreign = BreakGlassGrant::factory()->create(['tenant_id' => $other->id]);

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    $response = $this->actingAs($admin)
        ->getJson(breakGlassUrl())
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('id')->all();

    expect($ids)->toContain($own->id)
        ->and($ids)->not->toContain($foreign->id);
});

it('refuses the grant register to a rider', function () {
    $tenant = Tenant::factory()->create();

    $rider = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole(ClinicalRole::Rider->value);

        return $user;
    });

    $this->actingAs($rider)
        ->getJson(breakGlassUrl())
        ->assertForbidden();
});

it('refuses the grant register to an unauthenticated caller', function () {
    $this->getJson(breakGlassUrl())->assertUnauthorized();
});
