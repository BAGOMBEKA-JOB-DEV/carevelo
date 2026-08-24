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

    /*
     * THE Referer IS LOAD-BEARING AND LOOKS LIKE NOISE. Sanctum starts a session
     * only for a request whose Origin or Referer host is in `config/sanctum.php`'s
     * stateful list -- a browser always sends one and Laravel's test client never
     * does. Without it `EnsureFrontendRequestsAreStateful` skips StartSession, so
     * `$request->hasSession()` is false, `RequireSecondFactor` can find no verified
     * stamp however it was placed, and every call here answers 403.
     *
     * These tests predate the second factor entirely, which is why the header was
     * never needed before. @see tests/Feature/Platform/TotpEnrolmentTest.php
     */
    $this->withHeader('Referer', sprintf(
        'http://%s/',
        parse_url((string) config('app.url'), PHP_URL_HOST),
    ));
});

function breakGlassUrl(string $path = '/api/v1/platform/break-glass'): string
{
    return sprintf('http://%s%s', parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function platformOperator(ClinicalRole $role = ClinicalRole::PlatformSupport): User
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

/**
 * Audit events belonging to a clinic are only visible inside its context.
 *
 * @return array<int, string>
 */
function tenantAuditActions(Tenant $tenant): array
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): array => AuditEvent::query()->pluck('action')->map(strval(...))->values()->all(),
    );
}

it('records a reason, a scope, a time box and the tenant notification', function () {
    $tenant = Tenant::factory()->create();

    $response = $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), grantRequest($tenant))
        ->assertCreated();

    expect($response->json('data.reason'))->toContain('CV-4821')
        ->and($response->json('data.scope'))->toBe('consultation')
        ->and($response->json('data.expires_at'))->not->toBeNull()
        // The clinic is the controller and has a right to know when its
        // processor read its records. An unnotified grant is not a grant.
        ->and($response->json('data.tenant_notified_at'))->not->toBeNull()
        ->and($response->json('data.permits_access_now'))->toBeTrue();

    $grant = BreakGlassGrant::query()->findOrFail((string) $response->json('data.id'));

    expect($grant->wasTenantNotified())->toBeTrue()
        ->and($grant->expires_at->isFuture())->toBeTrue();
});

it('writes the notification into the clinic\'s own audit trail', function () {
    // Not a side channel the clinic has to be told to check: it lands in the
    // trail the clinic's administrator already reads.
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), grantRequest($tenant))
        ->assertCreated();

    expect(tenantAuditActions($tenant))->toContain('break_glass.tenant_notified');
});

it('rejects a grant with no reason', function () {
    $tenant = Tenant::factory()->create();

    $payload = grantRequest($tenant);
    unset($payload['reason']);

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), $payload)
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonValidationErrors('reason');

    expect(BreakGlassGrant::query()->count())->toBe(0);
});

it('rejects a reason too thin for a reviewer to act on', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), [...grantRequest($tenant), 'reason' => 'debug'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');
});

it('rejects a grant with no scope', function () {
    $tenant = Tenant::factory()->create();

    $payload = grantRequest($tenant);
    unset($payload['scope']);

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('scope');
});

it('rejects a scope outside the closed list', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), [...grantRequest($tenant), 'scope' => 'everything'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('scope');
});

it('rejects a grant with no time box', function () {
    $tenant = Tenant::factory()->create();

    $payload = grantRequest($tenant);
    unset($payload['expires_at']);

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('expires_at');
});

it('rejects a time box longer than the maximum', function () {
    // Standing access wearing an exception's costume. A longer investigation
    // issues a second grant, which is notified and audited again.
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), [
            ...grantRequest($tenant),
            'expires_at' => Date::now()->addHours(BreakGlassGrant::MAX_DURATION_HOURS + 1)->toIso8601String(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('expires_at');
});

it('rejects a time box that has already elapsed', function () {
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(platformOperator())
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
    $operator = platformOperator();

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
    $operator = platformOperator();

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

    /** @var array<string, mixed> $metadata */
    $metadata = app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::query()
        ->where('action', 'break_glass.accessed')
        ->firstOrFail()
        ->metadata) ?? [];

    $encoded = strtolower((string) json_encode($metadata));

    foreach (['namuli', 'nakiwala', 'diagnosis', 'medicine', 'reason'] as $term) {
        expect($encoded)->not->toContain($term, "The break-glass audit event leaked '{$term}'");
    }

    // Identifiers and outcomes, which is the whole of what an audit event holds.
    expect($metadata)->toHaveKeys(['operator_id', 'scope', 'record_id'])
        ->and($metadata['record_id'])->toBe($patient->id);
});

it('refuses access under an expired grant', function () {
    // The time box is the control. A grant that expires mid-investigation stops
    // working mid-investigation, because it is re-checked on every access.
    $tenant = Tenant::factory()->create();
    $operator = platformOperator();

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
    $operator = platformOperator();

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
    $operator = platformOperator();

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
    $operator = platformOperator();

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
    $operator = platformOperator();

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
    $granted = platformOperator();
    $borrower = platformOperator();

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
    // Pin the starting scope. The factory picks one at random, so an unpinned
    // grant was already 'audit_trail' about one run in four -- the assignment
    // below then set the value it already held, the model was never dirty,
    // save() was a no-op, and the updating hook that raises this exception
    // never ran. The test failed intermittently while the guard was fine.
    $grant = BreakGlassGrant::factory()->forScope('patient_record')->create();

    expect(function () use ($grant) {
        $grant->scope = 'audit_trail';
        $grant->save();
    })->toThrow(LogicException::class);

    expect(function () use ($grant) {
        $grant->expires_at = Date::now()->addDays(30);
        $grant->save();
    })->toThrow(LogicException::class);
});

it('keeps the time box intact across a database round trip', function () {
    // The subtle one. These are timestamptz columns, and a naive timestamp is
    // resolved by PostgreSQL in the session's timezone rather than the
    // application's -- so a two-hour grant silently became a grant that had
    // already expired, or could as easily have become a longer one.
    $tenant = Tenant::factory()->create();

    $response = $this->actingAsOperator(platformOperator())
        ->postJson(breakGlassUrl(), [
            ...grantRequest($tenant),
            'expires_at' => Date::now()->addHours(2)->toIso8601String(),
        ])
        ->assertCreated();

    $grant = BreakGlassGrant::query()->findOrFail((string) $response->json('data.id'));

    expect($grant->hasExpired())->toBeFalse()
        ->and($grant->expires_at->diffInMinutes(Date::now(), absolute: true))
        ->toBeGreaterThan(110)
        ->and($grant->expires_at->diffInMinutes(Date::now(), absolute: true))
        ->toBeLessThan(130);
});

it('lists the grant register for a platform reviewer', function () {
    $tenant = Tenant::factory()->create();
    $grant = BreakGlassGrant::factory()->create(['tenant_id' => $tenant->id]);

    $response = $this->actingAsOperator(platformOperator(ClinicalRole::PlatformAdmin))
        ->getJson(breakGlassUrl())
        ->assertOk();

    expect(array_column((array) $response->json('data'), 'id'))->toContain($grant->id);
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

    $ids = array_column((array) $response->json('data'), 'id');

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
