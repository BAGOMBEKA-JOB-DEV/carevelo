<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\StaffInvitation;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Factories\StaffInvitationFactory;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Hash;

/*
|--------------------------------------------------------------------------
| Staff invitations
|--------------------------------------------------------------------------
|
| Single-use, tenant-bound, expiring, token hashed at rest -- and the role fixed
| at invitation. That last one is the test to read: a public endpoint that took
| a role from the request body would be a one-request path from "front desk" to
| the role that can rewrite the clinic's aggregator credentials.
|
| See docs/40-api/authentication-and-sessions.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/** The tenant is resolved from the HOST. Never a path, query or body field. */
function inviteUrl(Tenant $tenant, string $path): string
{
    return sprintf(
        'http://%s.%s%s',
        $tenant->subdomain,
        parse_url((string) config('app.url'), PHP_URL_HOST),
        $path,
    );
}

/** @return array{Tenant, StaffInvitation, string} */
function inviteFixture(ClinicalRole $role = ClinicalRole::FrontDesk, string $phone = '+256772700100'): array
{
    $tenant = Tenant::factory()->create();

    [$invitation, $token] = app(Tenancy::class)->run(
        $tenant->id,
        fn (): array => StaffInvitation::issue($phone, 'Grace Nakato', $role),
    );

    return [$tenant, $invitation, $token];
}

/** @return array<int, AuditEvent> */
function inviteAudit(Tenant $tenant, string $action): array
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): array => AuditEvent::query()->where('action', $action)->orderBy('id')->get()->values()->all(),
    );
}

it('creates the account in the invited role and signs the invitee in', function () {
    [$tenant, $invitation, $token] = inviteFixture();

    $response = $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), [
        'password' => 'a-perfectly-good-password',
        'password_confirmation' => 'a-perfectly-good-password',
    ])->assertCreated();

    $user = app(Tenancy::class)->run(
        $tenant->id,
        fn (): ?User => User::query()->where('phone', '+256772700100')->first(),
    );

    expect($user)->not->toBeNull()
        ->and($user?->name)->toBe('Grace Nakato')
        ->and($user?->tenant_id)->toBe($tenant->id)
        ->and($user?->hasRole(ClinicalRole::FrontDesk->value))->toBeTrue()
        // The token arrived by SMS at that number, so the number is proven.
        ->and($user?->getAttribute('phone_verified_at'))->not->toBeNull()
        ->and($response->json('id'))->toBe($user?->id);

    $this->assertAuthenticatedAs($user);

    // Inside the tenant context: outside it, row-level security correctly hides
    // the row and fresh() reads back null.
    $accepted = app(Tenancy::class)->run($tenant->id, fn (): ?StaffInvitation => $invitation->fresh());

    expect($accepted?->accepted_user_id)->toBe($user?->id)
        ->and($accepted?->accepted_at)->not->toBeNull();

    expect(inviteAudit($tenant, 'invitation.accepted'))->toHaveCount(1);
});

it('ignores a role in the request body', function () {
    // THE privilege-escalation test. clinic_admin is the role that can change the
    // clinic's aggregator credentials -- the highest-value target in a tenant --
    // and this endpoint is public.
    [$tenant, , $token] = inviteFixture(ClinicalRole::FrontDesk);

    $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), [
        'password' => 'a-perfectly-good-password',
        'password_confirmation' => 'a-perfectly-good-password',
        'role' => ClinicalRole::ClinicAdmin->value,
        'tenant_id' => Tenant::factory()->create()->id,
    ])->assertCreated();

    $user = app(Tenancy::class)->run(
        $tenant->id,
        fn (): ?User => User::query()->where('phone', '+256772700100')->first(),
    );

    expect($user?->hasRole(ClinicalRole::FrontDesk->value))->toBeTrue()
        ->and($user?->hasRole(ClinicalRole::ClinicAdmin->value))->toBeFalse()
        ->and($user?->tenant_id)->toBe($tenant->id);
});

it('accepts an invitation exactly once', function () {
    [$tenant, , $token] = inviteFixture();

    $body = [
        'password' => 'a-perfectly-good-password',
        'password_confirmation' => 'a-perfectly-good-password',
    ];

    $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), $body)
        ->assertCreated();

    $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), $body)
        ->assertStatus(409)
        ->assertJsonPath('code', 'invitation_already_accepted');

    expect(app(Tenancy::class)->run($tenant->id, fn (): int => User::query()->where('phone', '+256772700100')->count()))
        ->toBe(1);
});

it('refuses an expired invitation', function () {
    // An invitation that never dies is an unrevoked credential sitting in an SMS
    // inbox on a handset that has since changed hands.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, fn () => StaffInvitation::factory()->expired()->create([
        'phone' => '+256772700100',
    ]));

    $this->postJson(
        inviteUrl($tenant, '/api/v1/invitations/'.StaffInvitationFactory::KNOWN_TOKEN.'/accept'),
        ['password' => 'a-perfectly-good-password', 'password_confirmation' => 'a-perfectly-good-password'],
    )
        ->assertStatus(410)
        ->assertJsonPath('code', 'invitation_expired');

    $this->assertGuest();
});

it('returns a neutral 404 for a token that does not exist', function () {
    $tenant = Tenant::factory()->create();

    $this->postJson(
        inviteUrl($tenant, '/api/v1/invitations/not-a-real-token/accept'),
        ['password' => 'a-perfectly-good-password', 'password_confirmation' => 'a-perfectly-good-password'],
    )
        ->assertNotFound()
        ->assertJsonPath('code', 'not_found');
});

it('will not accept another clinic\'s invitation, and says only 404', function () {
    // Row-level security means the row is not there on this host. A 403 would
    // confirm the invitation exists somewhere, which confirms that a given
    // person was invited to some clinic.
    [, , $token] = inviteFixture();
    $otherClinic = Tenant::factory()->create();

    $this->postJson(
        inviteUrl($otherClinic, "/api/v1/invitations/{$token}/accept"),
        ['password' => 'a-perfectly-good-password', 'password_confirmation' => 'a-perfectly-good-password'],
    )->assertNotFound();

    $this->assertGuest();
});

it('stores the token hashed and never in the clear', function () {
    [$tenant, $invitation, $token] = inviteFixture();

    expect($invitation->token_hash)->not->toBe($token)
        ->and($invitation->token_hash)->toBe(hash('sha256', $token))
        ->and(strlen($token))->toBe(StaffInvitation::TOKEN_BYTES * 2);

    $row = app(Tenancy::class)->run(
        $tenant->id,
        fn (): string => (string) json_encode(StaffInvitation::query()->get()->toArray()),
    );

    expect($row)->not->toContain($token);
});

it('finds an invitation only by its exact token', function () {
    [$tenant, $invitation, $token] = inviteFixture();

    app(Tenancy::class)->run($tenant->id, function () use ($invitation, $token) {
        expect(StaffInvitation::findByToken($token)?->id)->toBe($invitation->id)
            ->and(StaffInvitation::findByToken($token.'x'))->toBeNull()
            ->and(StaffInvitation::findByToken(substr($token, 0, -1)))->toBeNull();
    });
});

it('refuses to invite anybody into a platform role', function () {
    // A platform role reaches across tenants, so no tenant may hand one out --
    // least of all through a link sent by SMS.
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        expect(fn () => StaffInvitation::issue('+256772700100', 'Nobody', ClinicalRole::PlatformAdmin))
            ->toThrow(InvalidArgumentException::class);
    });
});

it('refuses when the number already has an account at this clinic', function () {
    [$tenant, , $token] = inviteFixture();

    app(Tenancy::class)->run($tenant->id, fn () => User::factory()->create([
        'tenant_id' => $tenant->id,
        'phone' => '+256772700100',
    ]));

    $this->postJson(
        inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"),
        ['password' => 'a-perfectly-good-password', 'password_confirmation' => 'a-perfectly-good-password'],
    )
        ->assertStatus(409)
        ->assertJsonPath('code', 'account_exists');
});

it('requires a password that is worth having', function () {
    [$tenant, , $token] = inviteFixture();

    $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), [
        'password' => 'short',
        'password_confirmation' => 'short',
    ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    expect($this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), [
        'password' => 'a-perfectly-good-password',
        'password_confirmation' => 'a-different-password',
    ])->status())->toBe(422);
});

it('lets the invitee sign in with the password they just set', function () {
    [$tenant, , $token] = inviteFixture(ClinicalRole::Pharmacist);

    $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), [
        'password' => 'a-perfectly-good-password',
        'password_confirmation' => 'a-perfectly-good-password',
    ])->assertCreated();

    $this->postJson(inviteUrl($tenant, '/api/v1/auth/sign-out'))->assertNoContent();

    $this->postJson(inviteUrl($tenant, '/api/v1/auth/sign-in'), [
        'phone' => '0772700100',
        'password' => 'a-perfectly-good-password',
    ])->assertOk();

    $user = app(Tenancy::class)->run(
        $tenant->id,
        fn (): ?User => User::query()->where('phone', '+256772700100')->first(),
    );

    expect(Hash::check('a-perfectly-good-password', (string) $user?->getAuthPassword()))->toBeTrue();
});

it('accepts an invitee who has no email address', function () {
    // Most Ugandan clinic staff have a working phone and no reliably checked
    // email address. Requiring one here would stop them joining.
    [$tenant, , $token] = inviteFixture();

    $this->postJson(inviteUrl($tenant, "/api/v1/invitations/{$token}/accept"), [
        'password' => 'a-perfectly-good-password',
        'password_confirmation' => 'a-perfectly-good-password',
    ])->assertCreated();

    $user = app(Tenancy::class)->run(
        $tenant->id,
        fn (): ?User => User::query()->where('phone', '+256772700100')->first(),
    );

    // A reserved, unroutable domain: this can never become somewhere a message
    // is actually sent.
    expect($user?->email)->toEndWith('@invitation.invalid');
});
