<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| H4 §3 — cash taken at the clinic
|--------------------------------------------------------------------------
|
| The patient handed notes to a person behind a counter. No aggregator is
| involved and Carevelo never sees the money; all that is recorded is that a
| named member of the clinic's staff says it arrived.
|
| That makes the attribution and the audit event the entire substance of this
| endpoint, and the refusal to attest an aggregator-backed collection the
| control that keeps it honest.
|
| @see docs/50-security-compliance/payments-regulatory-boundary.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function cashUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function cashStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

function cashIntent(Tenant $tenant, PaymentMethod $method, PaymentIntentStatus $status): PaymentIntent
{
    return app(Tenancy::class)->run($tenant->id, fn () => PaymentIntent::factory()->create([
        'method' => $method,
        'aggregator' => $method->requiresAggregator() ? 'flutterwave' : null,
        'status' => $status,
        'payable_type' => 'dispense_order',
        'amount_minor' => 1_150_000,
    ]));
}

it('records a cash payment attested by a named member of staff', function () {
    $tenant = Tenant::factory()->create();
    $frontDesk = cashStaff($tenant, ClinicalRole::FrontDesk);
    $intent = cashIntent($tenant, PaymentMethod::CashAtClinic, PaymentIntentStatus::Initiated);

    $this->actingAs($frontDesk)
        ->postJson(cashUrl($tenant, "/api/v1/payment-intents/{$intent->id}/attest-cash"))
        ->assertOk()
        ->assertJsonPath('data.status', PaymentIntentStatus::Succeeded->value);

    app(Tenancy::class)->run($tenant->id, function () use ($intent, $frontDesk) {
        expect($intent->refresh()->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($intent->resolved_at)->not->toBeNull();

        // WHO attested is the entire value of the record. A self-reported
        // attester would not be a control, so the actor comes from the session.
        $event = AuditEvent::query()
            ->where('action', 'payment_intent.cash_attested')
            ->where('subject_id', $intent->id)
            ->firstOrFail();

        expect($event->getAttribute('actor_id'))->toBe($frontDesk->id);
    });
});

it('refuses to let staff hand-confirm a mobile money collection', function () {
    // This is the control that keeps the clinic's books from becoming fiction.
    // Only the aggregator that took the money, or reconciliation, resolves an
    // aggregator-backed collection.
    $tenant = Tenant::factory()->create();
    $frontDesk = cashStaff($tenant, ClinicalRole::FrontDesk);
    $intent = cashIntent($tenant, PaymentMethod::MtnMomo, PaymentIntentStatus::Pending);

    $this->actingAs($frontDesk)
        ->postJson(cashUrl($tenant, "/api/v1/payment-intents/{$intent->id}/attest-cash"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect($intent->refresh()->status)->toBe(PaymentIntentStatus::Pending);
    });
});

it('refuses to attest the same cash twice', function () {
    // Cash is not received twice. Succeeded is not a state this endpoint can
    // re-enter.
    $tenant = Tenant::factory()->create();
    $frontDesk = cashStaff($tenant, ClinicalRole::FrontDesk);
    $intent = cashIntent($tenant, PaymentMethod::CashAtClinic, PaymentIntentStatus::Initiated);

    $this->actingAs($frontDesk)
        ->postJson(cashUrl($tenant, "/api/v1/payment-intents/{$intent->id}/attest-cash"))
        ->assertOk();

    $this->actingAs($frontDesk)
        ->postJson(cashUrl($tenant, "/api/v1/payment-intents/{$intent->id}/attest-cash"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');

    app(Tenancy::class)->run($tenant->id, function () {
        expect(AuditEvent::query()->where('action', 'payment_intent.cash_attested')->count())->toBe(1);
    });
});

it('refuses to let a rider attest a payment', function () {
    $tenant = Tenant::factory()->create();
    $rider = cashStaff($tenant, ClinicalRole::Rider);
    $intent = cashIntent($tenant, PaymentMethod::CashAtClinic, PaymentIntentStatus::Initiated);

    $this->actingAs($rider)
        ->postJson(cashUrl($tenant, "/api/v1/payment-intents/{$intent->id}/attest-cash"))
        ->assertForbidden();
});

it('returns 404 not 403 for an intent in another clinic', function () {
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $intentOfA = cashIntent($tenantA, PaymentMethod::CashAtClinic, PaymentIntentStatus::Initiated);
    $staffOfB = cashStaff($tenantB, ClinicalRole::FrontDesk);

    $this->actingAs($staffOfB)
        ->postJson(cashUrl($tenantB, "/api/v1/payment-intents/{$intentOfA->id}/attest-cash"))
        ->assertNotFound();
});
