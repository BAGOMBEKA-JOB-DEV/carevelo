<?php

use App\Models\ClinicalRole;
use App\Models\OutboundNotification;
use App\Models\StaffInvitation;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Notifications\TemplateRegistry;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| H1 -- the clinic's staff list
|--------------------------------------------------------------------------
|
| The refusal that matters most here is the one that looks like an
| inconvenience: THE LAST ACTIVE ADMINISTRATOR CANNOT LOSE ADMINISTRATIVE
| ACCESS. Locking a clinic out of its own tenant is a support incident that
| takes database access to undo, and it is worse than that -- the clinic is the
| data controller for every record inside, and a controller that cannot reach
| its own data cannot answer a subject-access request or a regulator.
|
| See docs/10-product/prd-h1-clinic-onboarding.md section 6 and
| docs/50-security-compliance/rbac-matrix.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function h1StaffUrl(Tenant $tenant, string $path = '/api/v1/tenant/users'): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function h1StaffMember(Tenant $tenant, ClinicalRole $role, bool $active = true): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role, $active) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'is_active' => $active]);
        $user->assignRole($role->value);

        return $user;
    });
}

/** @return array{Tenant, User} */
function h1StaffFixture(): array
{
    $tenant = Tenant::factory()->create();

    return [$tenant, h1StaffMember($tenant, ClinicalRole::ClinicAdmin)];
}

/**
 * The `id` of every row in a decoded staff-list body.
 *
 * @return list<string>
 */
function h1StaffIds(mixed $rows): array
{
    $ids = [];

    foreach (is_array($rows) ? $rows : [] as $row) {
        if (is_array($row) && is_string($row['id'] ?? null)) {
            $ids[] = $row['id'];
        }
    }

    return $ids;
}

/**
 * One row of a decoded staff-list body, by id.
 *
 * @return array<string, mixed>
 */
function h1StaffRow(mixed $rows, string $id): array
{
    foreach (is_array($rows) ? $rows : [] as $row) {
        if (is_array($row) && ($row['id'] ?? null) === $id) {
            return $row;
        }
    }

    return [];
}

// --- The staff list ------------------------------------------------------

it('lists this clinic\'s staff and nobody else\'s', function () {
    [$tenant, $admin] = h1StaffFixture();
    $colleague = h1StaffMember($tenant, ClinicalRole::Pharmacist);

    $otherClinic = Tenant::factory()->create();
    $stranger = h1StaffMember($otherClinic, ClinicalRole::ClinicAdmin);

    $ids = h1StaffIds(
        $this->actingAs($admin)->getJson(h1StaffUrl($tenant))->assertOk()->json('data')
    );

    expect($ids)->toContain($admin->id);
    expect($ids)->toContain($colleague->id);
    expect($ids)->not->toContain($stranger->id);
});

it('keeps patient accounts out of the clinic\'s staff list', function () {
    // This cost nothing while patients had no accounts and became urgent the
    // moment front desk could create them. A clinic has tens of staff and
    // thousands of patients: without the role filter the staff list IS a patient
    // list, twenty-five at a time, with the people an administrator came to manage
    // somewhere past the end of it.
    //
    // It is also a data-minimisation failure in its own right. The staff surface
    // is administrative, and a patient's presence on it is not administration.
    [$tenant, $admin] = h1StaffFixture();
    $colleague = h1StaffMember($tenant, ClinicalRole::FrontDesk);
    $patientAccount = h1StaffMember($tenant, ClinicalRole::Patient);

    $ids = h1StaffIds(
        $this->actingAs($admin)->getJson(h1StaffUrl($tenant))->assertOk()->json('data')
    );

    expect($ids)->toContain($admin->id);
    expect($ids)->toContain($colleague->id);
    expect($ids)->not->toContain($patientAccount->id);
});

it('returns 404, not 403, for a patient account on the staff endpoints', function () {
    // Same reasoning as another clinic's staff member: the account is not part of
    // the collection being addressed. It matters concretely too -- `role` here
    // would let an administrator promote a patient account into a clinical role,
    // and `is_active` would let them lock a patient out of their own records from
    // a screen that is not about patients at all.
    [$tenant, $admin] = h1StaffFixture();
    $patientAccount = h1StaffMember($tenant, ClinicalRole::Patient);

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$patientAccount->id), [
            'role' => ClinicalRole::Clinician->value,
        ])
        ->assertNotFound();

    expect($patientAccount->fresh()?->hasRole(ClinicalRole::Patient->value))->toBeTrue();
    expect($patientAccount->fresh()?->hasRole(ClinicalRole::Clinician->value))->toBeFalse();

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$patientAccount->id), ['is_active' => false])
        ->assertNotFound();

    expect($patientAccount->fresh()?->is_active)->toBeTrue();
});

it('gives the administrator roles and access, and no clinical trace of the person', function () {
    [$tenant, $admin] = h1StaffFixture();

    $row = h1StaffRow(
        $this->actingAs($admin)->getJson(h1StaffUrl($tenant))->assertOk()->json('data'),
        $admin->id,
    );

    expect(array_keys($row))->toEqualCanonicalizing([
        'id', 'name', 'phone', 'email', 'roles', 'is_active', 'phone_verified_at',
    ]);

    expect($row['roles'])->toBe([ClinicalRole::ClinicAdmin->value]);
});

// --- Invitations ---------------------------------------------------------

it('invites a colleague by phone and stores only a hash of the token', function () {
    Queue::fake();

    [$tenant, $admin] = h1StaffFixture();

    $response = $this->actingAs($admin)
        ->postJson(h1StaffUrl($tenant, '/api/v1/tenant/users/invite'), [
            'name' => 'Achieng Grace',
            'phone' => '0772 123 456',
            'role' => ClinicalRole::Pharmacist->value,
        ])
        ->assertCreated()
        ->assertJsonPath('data.role', ClinicalRole::Pharmacist->value);

    // The token leaves the request exactly once, in the SMS. Not in the
    // response, and not in the audit event.
    expect((string) $response->getContent())->not->toContain('token');

    [$invitation, $body] = app(Tenancy::class)->run($tenant->id, function () {
        return [
            StaffInvitation::query()->firstOrFail(),
            (string) OutboundNotification::query()
                ->where('template_key', TemplateRegistry::STAFF_INVITATION)
                ->value('body'),
        ];
    });

    expect((string) $invitation->phone)->toBe('+256772123456');
    expect($invitation->role)->toBe(ClinicalRole::Pharmacist->value);

    // The sent token, recovered from the message, hashes to what was stored --
    // so the stored value is demonstrably a hash and not the credential.
    expect(preg_match('#/invitations/([0-9a-f]{40,})#', $body, $matches))->toBe(1);
    expect($invitation->token_hash)->toBe(StaffInvitation::hashToken((string) ($matches[1] ?? '')));
    expect($body)->not->toContain($invitation->token_hash);
});

it('ticks the onboarding checklist as soon as an invitation is sent', function () {
    // Not once colleagues accept. The administrator has done their part, and a
    // checklist that waits on other people reads as their failure.
    Queue::fake();

    [$tenant, $admin] = h1StaffFixture();

    $this->actingAs($admin)
        ->postJson(h1StaffUrl($tenant, '/api/v1/tenant/users/invite'), [
            'name' => 'Achieng Grace',
            'phone' => '0772 123 456',
            'role' => ClinicalRole::Clinician->value,
        ])
        ->assertCreated();

    $items = h1ChecklistByKey(
        $this->actingAs($admin)
            ->getJson(h1StaffUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
            ->assertOk()
            ->json('data.items')
    );

    expect($items['staff']['is_complete'])->toBeTrue();
});

it('replaces an outstanding invitation rather than stacking a second one', function () {
    // Two live tokens for one person is two chances for the wrong one to be
    // spent, potentially into two different roles.
    Queue::fake();

    [$tenant, $admin] = h1StaffFixture();

    foreach ([ClinicalRole::FrontDesk, ClinicalRole::Dispatcher] as $role) {
        $this->actingAs($admin)
            ->postJson(h1StaffUrl($tenant, '/api/v1/tenant/users/invite'), [
                'name' => 'Achieng Grace',
                'phone' => '0772 123 456',
                'role' => $role->value,
            ])
            ->assertCreated();
    }

    app(Tenancy::class)->run($tenant->id, function () {
        expect(StaffInvitation::query()->count())->toBe(1);
        expect(StaffInvitation::query()->firstOrFail()->role)->toBe(ClinicalRole::Dispatcher->value);
    });
});

it('refuses to invite anyone into a role a clinic may not grant', function (string $role) {
    Queue::fake();

    [$tenant, $admin] = h1StaffFixture();

    $this->actingAs($admin)
        ->postJson(h1StaffUrl($tenant, '/api/v1/tenant/users/invite'), [
            'name' => 'Achieng Grace',
            'phone' => '0772 123 456',
            'role' => $role,
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    expect(app(Tenancy::class)->run($tenant->id, fn () => StaffInvitation::query()->count()))->toBe(0);
})->with([
    // A clinic minting a Carevelo operator would cross the isolation boundary
    // in one SMS.
    ClinicalRole::PlatformAdmin->value,
    ClinicalRole::PlatformSupport->value,
    ClinicalRole::BreakGlass->value,
    // A patient is not staff, and holds an entirely different relationship
    // with the clinic.
    ClinicalRole::Patient->value,
    'superuser',
]);

it('refuses an invitation to a number that is not a Ugandan phone', function () {
    Queue::fake();

    [$tenant, $admin] = h1StaffFixture();

    $this->actingAs($admin)
        ->postJson(h1StaffUrl($tenant, '/api/v1/tenant/users/invite'), [
            'name' => 'Achieng Grace',
            'phone' => '12345',
            'role' => ClinicalRole::FrontDesk->value,
        ])
        ->assertStatus(422);
});

// --- The last administrator ---------------------------------------------

it('refuses to deactivate the last active administrator', function () {
    [$tenant, $admin] = h1StaffFixture();

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$admin->id), ['is_active' => false])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition')
        ->assertJsonPath('title', fn (?string $title) => str_contains((string) $title, 'last active administrator'));

    expect($admin->fresh()?->is_active)->toBeTrue();
});

it('refuses to demote the last active administrator out of the role', function () {
    // Same lockout by a different route. Blocking only deactivation would leave
    // the door open.
    [$tenant, $admin] = h1StaffFixture();

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$admin->id), [
            'role' => ClinicalRole::FrontDesk->value,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    expect($admin->fresh()?->hasRole(ClinicalRole::ClinicAdmin->value))->toBeTrue();
});

it('counts only ACTIVE administrators when deciding whether one is the last', function () {
    // A second administrator who was deactivated last month is not a way back
    // in, so they must not satisfy the check.
    [$tenant, $admin] = h1StaffFixture();
    h1StaffMember($tenant, ClinicalRole::ClinicAdmin, active: false);

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$admin->id), ['is_active' => false])
        ->assertStatus(409);
});

it('allows deactivation once a second administrator is in place', function () {
    [$tenant, $admin] = h1StaffFixture();
    $secondAdmin = h1StaffMember($tenant, ClinicalRole::ClinicAdmin);

    $this->actingAs($secondAdmin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$admin->id), ['is_active' => false])
        ->assertOk()
        ->assertJsonPath('data.is_active', false);

    expect($admin->fresh()?->is_active)->toBeFalse();
});

it('deactivates a non-administrator without argument', function () {
    [$tenant, $admin] = h1StaffFixture();
    $rider = h1StaffMember($tenant, ClinicalRole::Rider);

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$rider->id), ['is_active' => false])
        ->assertOk()
        ->assertJsonPath('data.is_active', false);
});

it('changes a colleague\'s role to exactly one role', function () {
    [$tenant, $admin] = h1StaffFixture();
    $colleague = h1StaffMember($tenant, ClinicalRole::FrontDesk);

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$colleague->id), [
            'role' => ClinicalRole::Dispatcher->value,
        ])
        ->assertOk()
        ->assertJsonPath('data.roles', [ClinicalRole::Dispatcher->value]);
});

// --- Isolation and authorisation ----------------------------------------

it('returns 404, not 403, for a staff member of another clinic', function () {
    // User is deliberately not tenant-scoped -- authentication has to find a
    // user before a tenant is resolved -- so route binding will hand the
    // controller another clinic's staff member. A 403 would confirm the account
    // exists, disclosing that a given person works at some other clinic on
    // Carevelo, which is that clinic's commercial information.
    [$tenant, $admin] = h1StaffFixture();

    $stranger = h1StaffMember(Tenant::factory()->create(), ClinicalRole::Pharmacist);

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$stranger->id), ['is_active' => false])
        ->assertNotFound();

    expect($stranger->fresh()?->is_active)->toBeTrue();
});

it('refuses to move a staff member between clinics', function () {
    [$tenant, $admin] = h1StaffFixture();
    $colleague = h1StaffMember($tenant, ClinicalRole::FrontDesk);
    $otherClinic = Tenant::factory()->create();

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$colleague->id), [
            'tenant_id' => $otherClinic->id,
        ])
        ->assertStatus(422);

    expect($colleague->fresh()?->tenant_id)->toBe($tenant->id);
});

it('refuses to set another person\'s password', function () {
    [$tenant, $admin] = h1StaffFixture();
    $colleague = h1StaffMember($tenant, ClinicalRole::FrontDesk);

    $this->actingAs($admin)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$colleague->id), [
            'password' => 'not-yours-to-set',
        ])
        ->assertStatus(422);
});

it('refuses the staff endpoints to every role but the administrator', function (ClinicalRole $role) {
    Queue::fake();

    $tenant = Tenant::factory()->create();
    $staff = h1StaffMember($tenant, $role);

    $this->actingAs($staff)->getJson(h1StaffUrl($tenant))->assertForbidden();

    $this->actingAs($staff)
        ->postJson(h1StaffUrl($tenant, '/api/v1/tenant/users/invite'), [
            'name' => 'Achieng Grace',
            'phone' => '0772 123 456',
            'role' => ClinicalRole::Rider->value,
        ])
        ->assertForbidden();

    $this->actingAs($staff)
        ->patchJson(h1StaffUrl($tenant, '/api/v1/tenant/users/'.$staff->id), ['name' => 'Renamed'])
        ->assertForbidden();
})->with([
    ClinicalRole::Clinician,
    ClinicalRole::Pharmacist,
    ClinicalRole::FrontDesk,
    ClinicalRole::Dispatcher,
    ClinicalRole::Rider,
]);

it('refuses an unauthenticated request', function () {
    $tenant = Tenant::factory()->create();

    $this->getJson(h1StaffUrl($tenant))->assertUnauthorized();
});
