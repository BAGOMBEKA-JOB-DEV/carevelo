<?php

use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Receipts, and the export of the records behind them
|--------------------------------------------------------------------------
|
| Two documents produced from the same rows for the clinic's own books, and both
| tested here for the same reason: each is a statement about money, and the
| statement has to be true. The clinic received the payment, not Carevelo, and
| Carevelo cannot see what the clinic holds.
|
| @see docs/50-security-compliance/payments-regulatory-boundary.md
| @see docs/10-product/prd-h5-payments-non-custodial.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function receiptUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function receiptStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * @param  array<string, mixed>  $attributes
 */
function receiptIntent(Tenant $tenant, array $attributes = []): PaymentIntent
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn () => PaymentIntent::factory()->create($attributes),
    );
}

it('names the clinic as payee and Carevelo nowhere', function () {
    // THE receipt test. The patient paid the clinic's own merchant account at a
    // BoU-licensed aggregator and the funds settled to the clinic direct.
    // Carevelo appearing as a payee would be a false statement on a financial
    // document and a claim of custody -- which is the NPS Act 2020 PSP category
    // and its UGX 250m-10bn capital requirement.
    $tenant = Tenant::factory()->create([
        'trading_name' => 'Kira Family Clinic',
        'legal_name' => 'Kira Health Services Limited',
        'district' => 'Wakiso',
    ]);

    $admin = receiptStaff($tenant, ClinicalRole::ClinicAdmin);

    $intent = receiptIntent($tenant, [
        'status' => PaymentIntentStatus::Succeeded,
        'aggregator_reference' => 'FLW-98213',
        'resolved_at' => Date::now(),
    ]);

    $response = $this->actingAs($admin)
        ->getJson(receiptUrl($tenant, "/api/v1/payment-intents/{$intent->id}/receipt"))
        ->assertOk()
        ->assertJsonPath('data.payee.name', 'Kira Family Clinic')
        ->assertJsonPath('data.payee.legal_name', 'Kira Health Services Limited')
        ->assertJsonPath('data.reference', $intent->reference)
        // The line the patient and the clinic can both quote, from the party
        // that actually moved the money.
        ->assertJsonPath('data.aggregator_reference', 'FLW-98213');

    expect(strtolower(json_encode($response->json()) ?: ''))->not->toContain('carevelo');

    // A financial document leaving the clinic. Who asked, against which attempt.
    app(Tenancy::class)->run($tenant->id, function () use ($intent) {
        expect(
            AuditEvent::query()
                ->where('action', 'payment_intent.receipt_issued')
                ->where('subject_id', $intent->id)
                ->exists()
        )->toBeTrue();
    });
});

it('has no receipt for a payment nobody has confirmed', function () {
    // A pending mobile-money collection may still fail. A receipt is a document
    // the patient will produce later to prove they paid, so issuing one for an
    // unresolved attempt manufactures the evidence.
    $tenant = Tenant::factory()->create();
    $admin = receiptStaff($tenant, ClinicalRole::ClinicAdmin);
    $intent = receiptIntent($tenant, ['status' => PaymentIntentStatus::Pending]);

    $this->actingAs($admin)
        ->getJson(receiptUrl($tenant, "/api/v1/payment-intents/{$intent->id}/receipt"))
        ->assertStatus(409)
        ->assertJsonPath('code', 'illegal_transition');
});

it('refuses a receipt to a rider', function () {
    $tenant = Tenant::factory()->create();
    $rider = receiptStaff($tenant, ClinicalRole::Rider);
    $intent = receiptIntent($tenant, ['status' => PaymentIntentStatus::Succeeded]);

    $this->actingAs($rider)
        ->getJson(receiptUrl($tenant, "/api/v1/payment-intents/{$intent->id}/receipt"))
        ->assertForbidden();
});

it('exports the clinic\'s own payment records as CSV, aggregator reference included', function () {
    // The single most useful field in the file: without it an administrator
    // cannot match one of our rows to a line on their own dashboard, and the
    // export is busywork.
    $tenant = Tenant::factory()->create();
    $admin = receiptStaff($tenant, ClinicalRole::ClinicAdmin);

    $intent = receiptIntent($tenant, [
        'status' => PaymentIntentStatus::Succeeded,
        'aggregator_reference' => 'FLW-55501',
        'resolved_at' => Date::now(),
    ]);

    $response = $this->actingAs($admin)
        ->get(receiptUrl($tenant, '/api/v1/reconciliation/export'))
        ->assertOk();

    expect($response->headers->get('content-type'))->toContain('text/csv');

    $csv = (string) $response->getContent();

    expect($csv)->toContain('aggregator_reference')
        ->and($csv)->toContain('FLW-55501')
        ->and($csv)->toContain($intent->reference);

    // It reconciles RECORDS, not money. No total, no reconciled figure, no
    // variance -- each would be an assertion about funds that never passed
    // through us, and a clinic trusting it would reconcile against fiction.
    foreach (['balance', 'wallet', 'float', 'escrow', 'payout', 'settlement', 'total'] as $forbidden) {
        expect(str_contains(strtolower($csv), $forbidden))->toBeFalse("The export implies custody: '{$forbidden}'");
    }
});

it('audits the reconciliation export', function () {
    $tenant = Tenant::factory()->create();
    $admin = receiptStaff($tenant, ClinicalRole::ClinicAdmin);

    receiptIntent($tenant, ['status' => PaymentIntentStatus::Succeeded, 'resolved_at' => Date::now()]);

    $this->actingAs($admin)
        ->get(receiptUrl($tenant, '/api/v1/reconciliation/export'))
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () {
        $event = AuditEvent::query()->where('action', 'reconciliation.exported')->firstOrFail();

        expect($event->metadata['rows'] ?? null)->toBe(1);
    });
});

it('refuses the reconciliation export to a pharmacist', function () {
    // Only the administrator reconciles. A pharmacist prices and dispenses;
    // the clinic's books are not their surface.
    $tenant = Tenant::factory()->create();
    $pharmacist = receiptStaff($tenant, ClinicalRole::Pharmacist);

    $this->actingAs($pharmacist)
        ->get(receiptUrl($tenant, '/api/v1/reconciliation/export'))
        ->assertForbidden();
});

it('returns only the clinic\'s own records in the export', function () {
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $intentOfA = receiptIntent($tenantA, ['status' => PaymentIntentStatus::Succeeded]);
    $intentOfB = receiptIntent($tenantB, ['status' => PaymentIntentStatus::Succeeded]);

    $adminOfA = receiptStaff($tenantA, ClinicalRole::ClinicAdmin);

    $csv = (string) $this->actingAs($adminOfA)
        ->get(receiptUrl($tenantA, '/api/v1/reconciliation/export'))
        ->assertOk()
        ->getContent();

    expect($csv)->toContain($intentOfA->reference)
        ->and($csv)->not->toContain($intentOfB->reference);
});
