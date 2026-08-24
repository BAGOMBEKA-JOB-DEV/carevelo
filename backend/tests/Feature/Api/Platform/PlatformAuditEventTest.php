<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The platform audit register
|--------------------------------------------------------------------------
|
| GET /v1/platform/audit-events -- the read that stops the platform trail being
| write-only. Every control on the platform surface ends "and it is audited":
| break-glass grants, tenant provisioning and suspension, TOTP enrolments,
| platform sign-ins. All of them carry a null tenant_id, all of them are
| invisible from inside every tenant there is, and until this endpoint existed
| nothing could read any of them back. An unreadable audit trail is a belief.
|
| Each test below proves a RULE rather than a path, and the rules are the ones
| that make this endpoint safe to have at all:
|
|   1. it is behind the second factor, like everything else on this surface;
|   2. a password alone does not reach it;
|   3. a clinic administrator does not reach it on ANY host;
|   4. a clinic's own events come back as METADATA ONLY;
|   5. platform events come back at all, which is the gap this closes;
|   6. paging is by cursor, so nothing is seen twice and nothing is skipped;
|   7. reading it is itself audited, naming the clinic whose trail was read;
|   8. the fields it withholds cannot be asked about through a filter either.
|
| @see docs/50-security-compliance/audit-logging.md
| @see docs/50-security-compliance/rbac-matrix.md § Administration
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
     * stamp however it was placed, and every call here answers 403 -- including the
     * ones asserting a 200, which would then pass for the wrong reason.
     *
     * @see tests/Feature/Api/Platform/PlatformTenantTest.php
     */
    $this->withHeader('Referer', sprintf(
        'http://%s/',
        parse_url((string) config('app.url'), PHP_URL_HOST),
    ));
});

/** The cross-tenant control surface has no clinic host to be addressed on. */
function auditRegisterUrl(string $query = ''): string
{
    return sprintf(
        'http://%s/api/v1/platform/audit-events%s',
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $query,
    );
}

/** A Carevelo operator: no tenant_id, because we belong to no clinic. */
function auditOperator(ClinicalRole $role = ClinicalRole::PlatformSupport): User
{
    $operator = User::factory()->create(['tenant_id' => null]);
    $operator->assignRole($role->value);

    return $operator;
}

function auditClinicUser(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * An event belonging to Carevelo rather than to any clinic.
 *
 * Written with no tenant context, which is what the RLS policy's WITH CHECK arm requires of
 * a row with a null tenant -- the same state a platform route runs in.
 *
 * @param  array<string, mixed>  $metadata
 */
function platformAuditRow(string $action, array $metadata = [], int $secondsAgo = 0): AuditEvent
{
    return AuditEvent::create([
        'tenant_id' => null,
        'actor_type' => 'User',
        'actor_id' => (string) Str::ulid(),
        'actor_role' => ClinicalRole::PlatformAdmin->value,
        'action' => $action,
        'subject_type' => 'BreakGlassGrant',
        'subject_id' => (string) Str::ulid(),
        'occurred_at' => Date::now()->subSeconds($secondsAgo),
        'ip_address' => '102.0.0.1',
        'user_agent' => 'Carevelo console',
        'metadata' => $metadata,
    ]);
}

/**
 * An event belonging to a clinic.
 *
 * @param  array<string, mixed>  $metadata
 */
function clinicAuditRow(Tenant $tenant, string $action, array $metadata = []): AuditEvent
{
    return app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::create([
        'tenant_id' => $tenant->id,
        'actor_type' => 'User',
        'actor_id' => (string) Str::ulid(),
        'actor_role' => ClinicalRole::Clinician->value,
        'action' => $action,
        'subject_type' => 'Consultation',
        'subject_id' => (string) Str::ulid(),
        'occurred_at' => Date::now(),
        'ip_address' => '41.210.0.9',
        'user_agent' => 'Mozilla/5.0 (clinic laptop)',
        'metadata' => $metadata,
    ]));
}

it('serves the register to a platform operator who has completed a second factor', function () {
    // The rule: a verified platform session reads the platform trail. Everything
    // else in this file is about who may NOT, so this one establishes that the
    // door opens for the person it was built for.
    $grant = platformAuditRow('break_glass.granted', ['scope' => 'consultation']);

    $ids = $this->actingAsOperator(auditOperator())
        ->getJson(auditRegisterUrl())
        ->assertOk()
        ->json('data.*.id');

    expect($ids)->toContain($grant->id);
});

it('refuses a platform session that has proved only a password', function () {
    /*
     * PLAIN actingAs(), DELIBERATELY, and Tests\TestCase::actingAsOperator() says
     * so in its own docblock: a refusal test must be refused for the thing it
     * names. This one names the second factor, so the session it uses is exactly
     * the one a password alone produces -- authenticated, unverified.
     *
     * docs/40-api/authentication-and-sessions.md acceptance criterion 5: platform
     * operators cannot authenticate without a second factor. This is the widest
     * read surface in the product; if any route were going to be the one that
     * quietly skipped the group's gate, it would be a route added later, which is
     * what this test is here to catch.
     */
    platformAuditRow('auth.signed_in');

    $this->actingAs(auditOperator())
        ->getJson(auditRegisterUrl())
        ->assertForbidden()
        ->assertJsonPath('code', 'second_factor_required');
});

it('refuses a clinic administrator on the platform host and on their own clinic host', function () {
    /*
     * A clinic administrator reads their OWN trail in full at GET /v1/audit-events.
     * What they must never reach is this register, which spans Carevelo's own
     * events and -- with a tenant named -- somebody else's clinic.
     *
     * Plain actingAs() again, and here it matters twice: RequireSecondFactor lets
     * tenant accounts through by design (a clinic_admin legitimately reaches the
     * break-glass register in this same group), so the 403 below can only be the
     * controller refusing the ROLE. The second assertion is what proves which check
     * fired: a refusal for the missing FACTOR carries the `second_factor_required`
     * code, and this one must not, or the test would pass on a day the role check
     * was deleted.
     *
     * BOTH HOSTS, because the platform group runs without ResolveTenant: a request
     * for this path on a clinic subdomain is not stopped by tenancy on its way in,
     * so "cannot reach it at all" has to be true on the clinic's own host too.
     */
    $tenant = Tenant::factory()->create();
    $admin = auditClinicUser($tenant, ClinicalRole::ClinicAdmin);

    $onTheClinicsOwnHost = sprintf(
        'http://%s.%s/api/v1/platform/audit-events',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
    );

    foreach ([auditRegisterUrl(), $onTheClinicsOwnHost] as $url) {
        $refusal = $this->actingAs($admin)
            ->getJson($url)
            ->assertForbidden();

        expect($refusal->getContent())->not->toContain('second_factor_required');
    }
});

it('returns a clinic-owned event as metadata only, with no clinical content in it', function () {
    /*
     * THE RULE THIS ENDPOINT EXISTS FOR. docs/50-security-compliance/audit-logging.md
     * § Access: platform roles read "Platform events and metadata only for tenant
     * events". A platform operator must see THAT something happened, to which
     * clinic, by which actor and when -- and never the payload, the record reached
     * or the clinic staff member's address.
     *
     * Asserted as the ABSENCE OF NAMED FIELDS rather than as a shape, and then
     * again against the raw body: a value that leaked into some other key would
     * satisfy every per-field assertion and still be the breach.
     */
    $tenant = Tenant::factory()->create();

    $event = clinicAuditRow($tenant, 'consultation.read', [
        // Identifiers a clinic administrator legitimately sees on their own trail,
        // and which a processor does not need to know THAT the read happened.
        'consultation_id' => (string) Str::ulid(),
        'patient_id' => (string) Str::ulid(),
        'outcome' => 'completed',
    ]);

    $response = $this->actingAsOperator(auditOperator())
        ->getJson(auditRegisterUrl('?tenant_id='.$tenant->id))
        ->assertOk();

    /*
     * The clinic's trail holds exactly this one event: the `audit_log.read` written by the
     * request below goes into the PLATFORM trail, not into the clinic's. Asserted rather
     * than assumed, because every path assertion under it is written against `data.0`.
     */
    $response->assertJsonCount(1, 'data')
        // WHAT IT KEEPS: that it happened, to which clinic, by whom, of what kind, when.
        ->assertJsonPath('data.0.id', $event->id)
        ->assertJsonPath('data.0.tenant_id', $tenant->id)
        ->assertJsonPath('data.0.action', 'consultation.read')
        ->assertJsonPath('data.0.actor_id', $event->getAttribute('actor_id'))
        ->assertJsonPath('data.0.actor_role', ClinicalRole::Clinician->value)
        ->assertJsonPath('data.0.subject_type', 'Consultation')
        ->assertJsonPath('data.0.projection', 'metadata_only')
        // WHAT IT WITHHOLDS, field by named field. `metadata` goes whole rather than
        // scrubbed: it is free-form jsonb filtered on write by key name, which is a
        // denylist, and a denylist cannot prove absence on a table nothing can clean.
        ->assertJsonPath('data.0.metadata', null)
        // WHICH record. A page of these is a map of a clinic's patient population, built
        // out of the log that exists to protect it. Record-level detail is what a
        // break-glass grant is for, and that is reason-recorded, time-boxed and notified.
        ->assertJsonPath('data.0.subject_id', null)
        // The clinic's own staff, where they were and what they were holding. Personal
        // data of which that clinic, not Carevelo, is the controller.
        ->assertJsonPath('data.0.ip_address', null)
        ->assertJsonPath('data.0.user_agent', null);

    // And nowhere else in the body either.
    $body = $response->getContent();

    expect($body)->not->toContain((string) $event->getAttribute('subject_id'))
        ->and($body)->not->toContain('consultation_id')
        ->and($body)->not->toContain('patient_id')
        ->and($body)->not->toContain('41.210.0.9')
        ->and($body)->not->toContain('clinic laptop');
});

it('returns platform events, which are invisible from inside every tenant', function () {
    /*
     * The gap this endpoint closes, stated as a test. A break-glass grant carries a
     * null tenant_id, and the isolation policy on audit_events is disjoint in both
     * directions -- an unset context sees only null-tenant rows, and a tenant
     * context never sees them. So a grant was readable by nobody, anywhere, and the
     * periodic review that is supposed to notice a rising count had nothing to read.
     *
     * The second half of the assertion is the other direction of that disjointness:
     * standing in the platform trail, a clinic's row is not there. The response is
     * ONE TRAIL, which is row-level security being obeyed rather than worked around.
     */
    $tenant = Tenant::factory()->create();

    $grant = platformAuditRow('break_glass.granted', ['scope' => 'consultation']);
    $clinicEvent = clinicAuditRow($tenant, 'prescription.issued');

    $ids = $this->actingAsOperator(auditOperator())
        ->getJson(auditRegisterUrl())
        ->assertOk()
        ->json('data.*.id');

    expect($ids)->toContain($grant->id)
        ->and($ids)->not->toContain($clinicEvent->id);
});

it('returns each event exactly once across cursor pages', function () {
    /*
     * Cursor, never offset -- and this endpoint is the sharpest case for it in the
     * product, because READING IT WRITES TO IT. Every page turn appends an
     * `audit_log.read` event to the very trail being paged through, which is
     * exactly the traffic under which an offset duplicates rows and skips them.
     *
     * A skipped row on a security review is the row nobody looked at.
     */
    $created = collect(range(0, 4))
        ->map(fn (int $index): AuditEvent => platformAuditRow(
            'tenant.provisioned',
            ['index' => $index],
            secondsAgo: $index,
        ))
        ->pluck('id');

    $seen = [];
    $url = auditRegisterUrl('?per_page=2');
    $pages = 0;

    do {
        $page = $this->actingAsOperator(auditOperator())->getJson($url)->assertOk();

        $seen = array_merge($seen, $page->json('data.*.id'));

        $next = $page->json('meta.next_cursor');
        $url = is_string($next) ? auditRegisterUrl('?per_page=2&cursor='.$next) : null;

        // A guard rather than a `while (true)`: a paginator that never reported the
        // end would otherwise hang the suite instead of failing it.
        $pages++;
    } while ($url !== null && $pages < 10);

    expect($seen)->toHaveCount(count(array_unique($seen)), 'an event was returned on two pages')
        ->and(array_diff($created->all(), $seen))->toBeEmpty('an event was never returned');
});

it('audits the reading of the register, naming the clinic whose trail was read', function () {
    /*
     * Otherwise the log has a blind spot exactly where an insider would look -- and
     * the insider with the widest reach in this product is a Carevelo operator with
     * a verified platform session.
     *
     * The event lands in the PLATFORM trail even though a clinic's trail was read,
     * so that an operator's actions sit in one place in time order. `tenant_id` in
     * the metadata is what makes it answerable months later, and it names a clinic
     * rather than a person.
     */
    $tenant = Tenant::factory()->create();
    $operator = auditOperator();

    $this->actingAsOperator($operator)
        ->getJson(auditRegisterUrl('?tenant_id='.$tenant->id.'&action=consultation.read'))
        ->assertOk();

    $event = AuditEvent::query()
        ->where('action', 'audit_log.read')
        ->orderByDesc('occurred_at')
        ->firstOrFail();

    // Read with no tenant context, so finding it at all proves it is a platform row.
    expect($event->tenant_id)->toBeNull()
        ->and($event->getAttribute('actor_id'))->toBe($operator->id)
        ->and($event->metadata['surface'] ?? null)->toBe('platform')
        ->and($event->metadata['trail'] ?? null)->toBe('tenant')
        ->and($event->metadata['tenant_id'] ?? null)->toBe($tenant->id)
        // WHAT the operator went looking for. The filters answer that; the rows
        // that came back do not.
        ->and($event->metadata['filters'] ?? null)->toBe(['action' => 'consultation.read']);
});

it('offers no filter over the fields it withholds', function () {
    /*
     * A filter is a QUESTION, and a question about a withheld field is an oracle:
     * `?subject_id=...` would answer "does this clinic hold a record with this id"
     * for anybody who could guess one, without ever returning the field. The same
     * argument retires any filter over `metadata`, which would additionally turn
     * the audit log into a search index over whatever a caller once put there.
     *
     * RejectsUnknownFields is what makes this a 422 rather than a silently ignored
     * parameter -- the failure mode where an operator believes they narrowed a
     * cross-tenant read and did not.
     */
    $tenant = Tenant::factory()->create();

    $this->actingAsOperator(auditOperator())
        ->getJson(auditRegisterUrl('?subject_id='.Str::ulid()))
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    $this->actingAsOperator(auditOperator())
        ->getJson(auditRegisterUrl('?tenant_id='.$tenant->id.'&per_page=500'))
        ->assertStatus(422);
});
