<?php

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\PatientRecordClaims;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| Linking a patient record to an account
|--------------------------------------------------------------------------
|
| The step that makes the patient-account link real. Front desk registers a
| walk-in long before that person has any login, so the record and the account
| exist independently and something has to join them.
|
| Without this the link is a column nothing ever fills, and every `P own` endpoint
| returns an empty list to a patient who plainly has records. The column shipped
| before this did -- which is why there is a test asserting the wiring, not only
| the service.
|
| THE PROOF IS A MEMBER OF STAFF WHO SAW THE PERSON. It used to be a one-time
| code proving control of a handset, and that gate cannot be honestly satisfied
| any more: the code path was the only thing that ever set
| `users.phone_verified_at`. What replaced it is narrower, not looser -- the
| record is NAMED by a staff member at the registration desk rather than inferred
| from a phone number that happens to match, so nothing is ever claimed by
| coincidence. PatientAccountTest holds the other half of that bargain: the desk
| visit never writes phone_verified_at.
|
| @see docs/70-decisions/0010-patient-account-link.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/**
 * An account in its own clinic, in whatever role the caller names.
 *
 * No phone. Accounts issued at the registration desk never get one --
 * `users` carries unique(tenant_id, phone) and the collisions are ordinary --
 * so the fixture matches what the endpoint actually creates.
 *
 * @return array{Tenant, User}
 */
function claimAccount(ClinicalRole $role = ClinicalRole::Patient): array
{
    $tenant = Tenant::factory()->create();

    $user = app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => null]);
        $user->assignRole($role->value);

        return $user;
    });

    return [$tenant, $user];
}

function claimRecord(Tenant $tenant): Patient
{
    return app(Tenancy::class)->run($tenant->id, fn () => Patient::factory()->create());
}

function claimAttach(Tenant $tenant, User $user, Patient $patient): void
{
    app(Tenancy::class)->run($tenant->id, function () use ($user, $patient): void {
        app(PatientRecordClaims::class)->attachRecord($user, $patient);
    });
}

it('links the record it was named, and only that one', function () {
    // The whole difference from the sweep this replaced. A record is linked
    // because a member of staff pointed at it, never because a column matched.
    [$tenant, $user] = claimAccount();

    $named = claimRecord($tenant);
    $other = claimRecord($tenant);

    claimAttach($tenant, $user, $named);

    [$namedOwner, $otherOwner] = app(Tenancy::class)->run($tenant->id, fn () => [
        Patient::query()->findOrFail($named->id)->user_id,
        Patient::query()->findOrFail($other->id)->user_id,
    ]);

    expect($namedOwner)->toBe($user->id)
        ->and($otherOwner)->toBeNull();
});

it('lets one account hold a second record when staff link it deliberately', function () {
    // ADR-0010 chose one-to-many because a guardian holds their children's
    // records. That cardinality survives the change of proof -- what changed is
    // that each link is now a separate, audited act by a member of staff rather
    // than a side effect of somebody signing in.
    [$tenant, $guardian] = claimAccount();

    $firstChild = claimRecord($tenant);
    $secondChild = claimRecord($tenant);

    claimAttach($tenant, $guardian, $firstChild);
    claimAttach($tenant, $guardian, $secondChild);

    $held = app(Tenancy::class)->run($tenant->id, fn () => $guardian->fresh()?->ownedPatientIds() ?? []);

    expect($held)->toHaveCount(2)
        ->and($held)->toContain($firstChild->id)
        ->and($held)->toContain($secondChild->id);
});

it('refuses to hand a patient record to a staff account', function (ClinicalRole $role) {
    // THE line that stops a clinician acquiring a patient record through a side
    // door no policy inspects. A member of staff who genuinely is a patient here
    // holds a second account, exactly as attending two clinics is two accounts.
    [$tenant, $staff] = claimAccount($role);
    $record = claimRecord($tenant);

    expect(fn () => claimAttach($tenant, $staff, $record))->toThrow(IllegalTransition::class);

    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($record->id)->user_id))
        ->toBeNull();
})->with([
    ClinicalRole::Clinician,
    ClinicalRole::ClinicAdmin,
    ClinicalRole::FrontDesk,
    ClinicalRole::Pharmacist,
]);

it('never moves a record that another account already reaches', function () {
    // Reassignment is a decision for clinic staff working through a correction,
    // not something this method does on the way past. The first account keeps it.
    [$tenant, $first] = claimAccount();
    $record = claimRecord($tenant);

    claimAttach($tenant, $first, $record);

    $second = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => null]);
        $user->assignRole(ClinicalRole::Patient->value);

        return $user;
    });

    expect(fn () => claimAttach($tenant, $second, $record))->toThrow(IllegalTransition::class);

    expect(app(Tenancy::class)->run($tenant->id, fn () => Patient::query()->findOrFail($record->id)->user_id))
        ->toBe($first->id);
});

it('refuses a second link for a record it has already linked', function () {
    // The same account, the same record, twice. Not idempotent-and-silent: the
    // second call is a caller that believes something untrue about the record,
    // and telling it so is cheaper than letting it find out later.
    [$tenant, $user] = claimAccount();
    $record = claimRecord($tenant);

    claimAttach($tenant, $user, $record);

    expect(fn () => claimAttach($tenant, $user, $record))->toThrow(IllegalTransition::class);

    expect(app(Tenancy::class)->run($tenant->id, fn () => $user->fresh()?->ownedPatientIds() ?? []))
        ->toHaveCount(1);
});

it('never reaches across clinics', function () {
    // The composite foreign key on (tenant_id, user_id) already makes this
    // impossible, and its refusal is a QueryException and therefore a 500. On the
    // single write that grants a human being sight of a medical record, the clean
    // refusal is worth the two lines.
    [$tenantA, $user] = claimAccount();
    $tenantB = Tenant::factory()->create();

    $strangersRecord = claimRecord($tenantB);

    expect(fn () => claimAttach($tenantA, $user, $strangersRecord))->toThrow(IllegalTransition::class);

    expect(app(Tenancy::class)->run($tenantB->id, fn () => Patient::query()->findOrFail($strangersRecord->id)->user_id))
        ->toBeNull();
});

it('audits the claim against the record, saying what proved it and nothing else', function () {
    // "Who can read my records, and since when" has to be answerable per record.
    // The action name is unchanged from the phone-verified era on purpose: a
    // clinic's audit trail must not fork into two vocabularies for "an account
    // gained sight of this record". `via` is where the trust basis changed.
    [$tenant, $user] = claimAccount();
    $record = claimRecord($tenant);

    claimAttach($tenant, $user, $record);

    $event = app(Tenancy::class)->run($tenant->id, fn () => AuditEvent::query()
        ->where('action', 'patient.record_claimed')
        ->firstOrFail());

    expect($event->subject_type)->toBe('Patient')
        ->and($event->subject_id)->toBe($record->id)
        ->and($event->metadata)->toBe(['via' => 'staff_attested']);

    // An audit trail is not a contact list. AuditLog::scrub() strips several of
    // these already; that is defence in depth, not permission to pass them, and a
    // scrubber is a list that rots.
    $encoded = (string) json_encode($event->metadata);

    foreach ([$record->phone, $record->given_name, $record->family_name, (string) $user->email] as $leak) {
        expect($encoded)->not->toContain((string) $leak);
    }
});
