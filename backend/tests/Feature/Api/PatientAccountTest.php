<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\OutboundNotification;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Hash;

/*
|--------------------------------------------------------------------------
| H2 -- giving a patient a way in
|--------------------------------------------------------------------------
|
| There was no patient account-creation path in the product at all. A record
| could be registered, consented, consulted and dispensed against, and the person
| it described still had no way to sign in and look at any of it.
|
| CLINIC STAFF CREATE THE ACCOUNT, at the registration desk, and hand over an
| initial password. The account grants a human being sight of a medical record,
| so something has to establish that the human being is the right one, and a desk
| with the person and their ID document across it is the only place in this
| product where that check actually happens.
|
| The tests below use actingAs freely -- this file is about the endpoint, not
| about authentication. RealSignInFlowTest carries the same journey over real
| HTTP, from the front desk to the patient's own records, with no injected
| session anywhere.
|
| @see docs/70-decisions/0010-patient-account-link.md
| @see docs/40-api/authentication-and-sessions.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function accountUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic, a member of its staff, and an unclaimed patient record.
 *
 * @return array{Tenant, User, Patient}
 */
function accountFixture(ClinicalRole $role = ClinicalRole::FrontDesk): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $staff = User::factory()->create(['tenant_id' => $tenant->id]);
        $staff->assignRole($role->value);

        return [$tenant, $staff, Patient::factory()->create()];
    });
}

/** The account just created, read back inside its own tenant. */
function accountOf(Tenant $tenant, mixed $userId): User
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn (): User => User::query()->whereKey(is_string($userId) ? $userId : '')->firstOrFail(),
    );
}

function accountPath(Patient $patient): string
{
    return '/api/v1/patients/'.$patient->id.'/account';
}

// --- Creating the account ------------------------------------------------

it('creates the account, links the record, and hands the password over once', function () {
    [$tenant, $frontDesk, $patient] = accountFixture();

    $body = $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'Aisha.Nambooze@example.test'])
        ->assertCreated()
        ->assertJsonPath('data.patient_id', $patient->id)
        ->assertJsonPath('data.records_linked', 1)
        // Lowercased, so the address the account holds is the address
        // SignInRequest will look it up by.
        ->assertJsonPath('data.email', 'aisha.nambooze@example.test')
        ->json('data');

    expect($body['note'])->toContain('shown once');
    expect($body['initial_password'])->toBeString();
    expect($body['initial_password'])->not->toBeEmpty();

    $account = accountOf($tenant, $body['user_id']);

    expect($account->tenant_id)->toBe($tenant->id)
        // Named from the clinical record. A second spelling of a patient's name
        // is a data-quality trap with no upside.
        ->and($account->name)->toBe($patient->given_name.' '.$patient->family_name)
        ->and($account->hasRole(ClinicalRole::Patient->value))->toBeTrue()
        ->and($account->is_active)->toBeTrue();

    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($patient->id)->user_id))
        ->toBe($account->id);
});

it('stores only a hash of the password, and puts the plaintext nowhere else', function () {
    // The password exists in the 201 body and in the patient's head. Not in the
    // users row, not in an audit event, and NEVER in an SMS -- a message reading
    // "your password is ..." is the exact shape the deleted one-time-code
    // template forbade in its own docblock.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $body = $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertCreated()
        ->json('data');

    $plaintext = (string) $body['initial_password'];

    $account = accountOf($tenant, $body['user_id']);

    [$events, $messages] = app(Tenancy::class)->run($tenant->id, fn () => [
        (string) json_encode(AuditEvent::query()->get()->toArray()),
        (string) json_encode(OutboundNotification::query()->get()->toArray()),
    ]);

    expect($account->getAttribute('password'))->not->toBe($plaintext)
        ->and(Hash::check($plaintext, (string) $account->getAttribute('password')))->toBeTrue()
        ->and($events)->not->toContain($plaintext)
        ->and($messages)->not->toContain($plaintext)
        // Not a single message of any kind. The whole point of reading it across
        // the desk is that it never enters a gateway's outbox.
        ->and(app(Tenancy::class)->run($tenant->id, fn () => OutboundNotification::query()->count()))->toBe(0);
});

it('never marks the phone verified', function () {
    // THE test that pins this design decision shut. The one-time-code path was
    // the only thing that ever set users.phone_verified_at, and it set it because
    // a token had genuinely reached the handset. A desk visit proves that a person
    // stood at a desk, which is a different fact.
    //
    // StaffResource surfaces the column to administrators precisely so a clinic
    // can tell a genuinely verified contact number from one typed at a front desk.
    // Writing it here would poison that signal for every consumer of it, silently
    // and for ever.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $userId = $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertCreated()
        ->json('data.user_id');

    $account = accountOf($tenant, $userId);

    expect($account->getAttribute('phone_verified_at'))->toBeNull();
});

it('leaves the account without a phone number at all', function () {
    // users carries unique(tenant_id, phone), and there are two entirely ordinary
    // collisions: a member of staff who is also a patient of the clinic, and the
    // documented "patient has no phone, register against a next-of-kin number"
    // exception. Either would turn a legitimate desk action into a duplicate-key
    // 500.
    //
    // Notifications are unaffected, because ownership resolves through
    // patients.phone and never through users.phone.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $userId = $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertCreated()
        ->json('data.user_id');

    $account = accountOf($tenant, $userId);

    expect($account->getAttribute('phone'))->toBeNull();

    // The record keeps its own number, which is what a notification is addressed
    // to and what front desk rings.
    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($patient->id)->phone))
        ->toBe($patient->phone);
});

it('lets the patient sign in with the password that was read to them', function () {
    [$tenant, $frontDesk, $patient] = accountFixture();

    $body = $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertCreated()
        ->json('data');

    // The credential check is real, so this proves the password works whatever
    // session the staff member left behind: a wrong one is a 422.
    $this->postJson(accountUrl($tenant, '/api/v1/auth/sign-in'), [
        'email' => 'patient@example.test',
        'password' => $body['initial_password'],
    ])->assertOk();
});

// --- Refusals ------------------------------------------------------------

it('refuses a second account for a record that already has one', function () {
    [$tenant, $frontDesk, $patient] = accountFixture();

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'first@example.test'])
        ->assertCreated();

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'second@example.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'patient_already_has_account');

    expect(app(Tenancy::class)->run($tenant->id, fn () => User::query()
        ->where('tenant_id', $tenant->id)
        ->whereRaw('lower(email) = ?', ['second@example.test'])
        ->count()))->toBe(0);
});

it('refuses an address that is already an account at this clinic', function () {
    // Two front-desk terminals working the queue is the normal case, so the
    // check-then-insert race is real. A 409 rather than a neutral answer is right
    // here: the caller is an authenticated member of staff who can already read
    // every record and address at this clinic, so there is no enumeration surface.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $sibling = app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'shared@example.test'])
        ->assertCreated();

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($sibling)), ['email' => 'Shared@Example.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'account_exists');

    // And nothing half-made survived the refusal: the sibling is still unclaimed.
    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($sibling->id)->user_id))
        ->toBeNull();
});

it('refuses an address held by a DEACTIVATED account here', function () {
    // activeForEmail() deliberately cannot see deactivated accounts -- a "your
    // account is disabled" answer at sign-in would confirm the account exists --
    // so this refusal comes from the unique index and the catch around it. Without
    // the catch it is a 500 on an ordinary front-desk action.
    [$tenant, $frontDesk, $patient] = accountFixture();

    app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        User::factory()->create([
            'tenant_id' => $tenant->id,
            'email' => 'retired@example.test',
            'is_active' => false,
        ]);
    });

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'retired@example.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'account_exists');
});

it('allows the same address at another clinic', function () {
    // Uniqueness is (tenant_id, email). A family sharing an address, or a person
    // attending two clinics, is two accounts -- which follows directly from tenant
    // isolation.
    [$tenantA, $frontDeskA, $patientA] = accountFixture();
    [$tenantB, $frontDeskB, $patientB] = accountFixture();

    $this->actingAs($frontDeskA)
        ->postJson(accountUrl($tenantA, accountPath($patientA)), ['email' => 'shared@example.test'])
        ->assertCreated();

    $this->actingAs($frontDeskB)
        ->postJson(accountUrl($tenantB, accountPath($patientB)), ['email' => 'shared@example.test'])
        ->assertCreated();
});

it('refuses a merged duplicate', function () {
    // A merged duplicate is not the person any more; its history moved. An account
    // on it would open onto the empty half of somebody.
    [$tenant, $frontDesk, $patient] = accountFixture();

    app(Tenancy::class)->run($tenant->id, function () use ($patient) {
        $survivor = Patient::factory()->create();
        $patient->merged_into_patient_id = $survivor->id;
        $patient->save();
    });

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('refuses a discarded registration', function () {
    // Discarded means consent was declined, and the record exists only to explain
    // why service could not proceed. A login onto it is a consent refusal being
    // walked back by the clinic rather than by the patient.
    [$tenant, $frontDesk, $patient] = accountFixture();

    app(Tenancy::class)->run($tenant->id, function () use ($patient) {
        $patient->forceFill(['status' => PatientStatus::Discarded])->save();
    });

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

// --- Authorisation -------------------------------------------------------

it('refuses every role but the administrator and the front desk', function (ClinicalRole $role) {
    // THE CLINICIAN CASE IS THE SURPRISING ONE and it is explicit here so nobody
    // "fixes" the policy. merge() excludes clinicians for a reason that applies
    // verbatim: this is a registration-desk act, and the desk is where the person
    // and their ID document actually are. The whole trust basis of the account is
    // "a member of staff verified the human being in front of them", and a
    // clinician mid-consultation in a back room is not positioned to do that.
    [$tenant, , $patient] = accountFixture();

    $staff = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });

    $this->actingAs($staff)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertForbidden();

    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($patient->id)->user_id))
        ->toBeNull();
})->with([
    ClinicalRole::Clinician,
    ClinicalRole::Pharmacist,
    ClinicalRole::Dispatcher,
    ClinicalRole::Rider,
]);

it('refuses the patient acting on their own record', function () {
    // Self-service account creation would mean anybody who knows a name and a
    // record identifier could mint a login onto a medical record -- and the record
    // is exactly what the login grants sight of.
    [$tenant, , $patient] = accountFixture();

    $account = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $patient) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => null]);
        $user->assignRole(ClinicalRole::Patient->value);

        // Their OWN record, already theirs. The refusal must come from the policy
        // and not from the "already has an account" check further down, or the
        // day somebody creates a second record for themselves the policy is the
        // only thing standing there and it will not be.
        $patient->user_id = $user->id;
        $patient->save();

        return $user;
    });

    $this->actingAs($account)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertForbidden();
});

it('returns 404, not 403, for another clinic\'s record', function () {
    // Row-level security is bound before the router dispatches, so the record is
    // not hidden here -- it is not there. A 403 would confirm it exists.
    [$tenant, $frontDesk] = accountFixture();
    [$otherClinic, , $strangersRecord] = accountFixture();

    expect($otherClinic->id)->not->toBe($tenant->id);

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($strangersRecord)), ['email' => 'patient@example.test'])
        ->assertNotFound();
});

it('refuses an unauthenticated request', function () {
    [$tenant, , $patient] = accountFixture();

    $this->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertUnauthorized();
});

// --- The request body ----------------------------------------------------

it('refuses a password chosen by the member of staff', function () {
    // A front desk creating twenty accounts a day types the same password twenty
    // times, and then every account at that clinic is guessable by anyone who was
    // ever given one.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), [
            'email' => 'patient@example.test',
            'password' => 'kira2026',
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonPath('errors.password.0', fn (?string $message) => str_contains(
            (string) $message, 'Nobody chooses another person\'s password.'
        ));

    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($patient->id)->user_id))
        ->toBeNull();
});

it('refuses a separately typed name, and any field it does not define', function () {
    [$tenant, $frontDesk, $patient] = accountFixture();

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), [
            'email' => 'patient@example.test',
            'name' => 'Ayisha Namboze',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['name']);

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), [
            'email' => 'patient@example.test',
            'phone' => '0772 400 100',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['phone']);
});

it('refuses to create an account for a patient with no address to sign in with', function () {
    // users.email is NOT NULL and the address is now the only patient identifier.
    // Minting a placeholder -- which is what StaffInvitation does, and it is right
    // there only because the phone was the credential -- would create an account
    // nobody can ever sign into.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), [])
        ->assertStatus(422)
        ->assertJsonPath('errors.email.0', fn (?string $message) => str_contains(
            (string) $message, 'registered and treated as normal'
        ));
});

// --- The audit trail -----------------------------------------------------

it('audits the account and the claim, with identifiers and nothing else', function () {
    [$tenant, $frontDesk, $patient] = accountFixture();

    $userId = $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertCreated()
        ->json('data.user_id');

    [$created, $claimed] = app(Tenancy::class)->run($tenant->id, fn () => [
        AuditEvent::query()->where('action', 'patient.account_created')->firstOrFail(),
        AuditEvent::query()->where('action', 'patient.record_claimed')->firstOrFail(),
    ]);

    // The staff member is the actor on both. The patient did nothing here.
    expect($created->getAttribute('actor_id'))->toBe($frontDesk->id)
        ->and($claimed->getAttribute('actor_id'))->toBe($frontDesk->id)
        ->and($created->subject_type)->toBe('Patient')
        ->and($created->subject_id)->toBe($patient->id)
        ->and($claimed->subject_id)->toBe($patient->id);

    // EXACTLY these keys. AuditLog::scrub() strips several of the obvious leaks
    // already -- that is defence in depth, not permission to pass them -- and a
    // scrubber is a list, and lists rot.
    expect(array_keys((array) $created->metadata))->toEqualCanonicalizing(['user_id', 'via'])
        ->and($created->metadata['via'] ?? null)->toBe('staff_issued')
        ->and($created->metadata['user_id'] ?? null)->toBe($userId)
        ->and($claimed->metadata)->toBe(['via' => 'staff_attested']);

    $encoded = (string) json_encode([$created->metadata, $claimed->metadata]);

    foreach ([$patient->phone, $patient->given_name, $patient->family_name, 'patient@example.test'] as $leak) {
        expect($encoded)->not->toContain((string) $leak);
    }
});

// --- What staff see afterwards -------------------------------------------

it('tells staff on the patient record whether an account exists', function () {
    // Instead of an endpoint. A question whose only job is answering "does this
    // person have an account here" is one worth not being able to ask; reading it
    // off a record you are already authorised to read asks nothing new.
    [$tenant, $frontDesk, $patient] = accountFixture();

    $this->actingAs($frontDesk)
        ->getJson(accountUrl($tenant, '/api/v1/patients/'.$patient->id))
        ->assertOk()
        ->assertJsonPath('data.has_account', false);

    $this->actingAs($frontDesk)
        ->postJson(accountUrl($tenant, accountPath($patient)), ['email' => 'patient@example.test'])
        ->assertCreated();

    $this->actingAs($frontDesk)
        ->getJson(accountUrl($tenant, '/api/v1/patients/'.$patient->id))
        ->assertOk()
        ->assertJsonPath('data.has_account', true)
        // And still nothing about WHICH account, or its address.
        ->assertJsonMissing(['user_id']);
});
