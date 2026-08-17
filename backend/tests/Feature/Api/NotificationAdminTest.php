<?php

use App\Models\ClinicalRole;
use App\Models\OutboundNotification;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Notifications\TemplateRegistry;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;

/*
|--------------------------------------------------------------------------
| The notification administration surface
|--------------------------------------------------------------------------
|
| SMS IS NOT A CONFIDENTIAL CHANNEL. Messages transit the mobile operator, land
| on a lock screen anyone nearby can read, and sit in a shared handset's inbox
| indefinitely. The catalogue test below is the one that matters: it is the
| review gate on every string this platform is capable of sending.
|
| @see docs/10-product/notifications-sms-whatsapp.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function notifUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function notifStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

it('returns the catalogue with no clinical content in any template body', function () {
    // The prohibited list is blunt and will occasionally refuse something
    // harmless. That is the correct trade: a false refusal is a support ticket,
    // and a false pass is a notifiable disclosure of special-category data under
    // DPPA 2019.
    $tenant = Tenant::factory()->create();
    $admin = notifStaff($tenant, ClinicalRole::ClinicAdmin);

    $templates = $this->actingAs($admin)
        ->getJson(notifUrl($tenant, '/api/v1/notification-templates'))
        ->assertOk()
        ->json('data');

    expect($templates)->toBeArray()->not->toBeEmpty();

    $prohibited = [
        // Diagnoses and findings.
        'diagnos', 'test result', 'lab result', 'results are', 'positive', 'negative',
        'malaria', 'hiv', 'typhoid', 'cholera', 'diabet', 'hypertens', 'cancer',
        'infection', 'symptom', 'disease', 'pregnan', 'antenatal',
        // Medicines, and the shape of a dosage line.
        'amoxicillin', 'paracetamol', 'coartem', 'artemether', 'metformin',
        'ibuprofen', 'azithromycin', 'insulin', 'morphine', 'codeine', 'panadol',
        'septrin', 'dosage', 'tablet', 'capsule', 'syrup', 'injection',
        'medicine', 'medication', 'clinical note', 'reason for', 'treatment for',
    ];

    foreach ($templates as $template) {
        $key = (string) $template['key'];
        $body = mb_strtolower((string) $template['body']);

        foreach ($prohibited as $term) {
            expect($body)->not->toContain($term, "Template [{$key}] contains '{$term}'");
        }

        // Every message identifies the clinic as sender. One a patient cannot
        // attribute to the clinic they attended reads as a scam, and patients
        // are right to ignore it.
        expect($body)->toContain('{clinic}');
    }
});

it('says nothing about a result beyond the fact that one exists', function () {
    // The bare word "result" cannot simply be banned: "Your results from
    // {clinic} are ready. Sign in to view them" is the message §H6.2 mandates,
    // and it is the entire permissible one. So the check is that no OTHER
    // template mentions a result at all, and that the one that does says only
    // where to sign in.
    $tenant = Tenant::factory()->create();
    $admin = notifStaff($tenant, ClinicalRole::ClinicAdmin);

    $templates = $this->actingAs($admin)
        ->getJson(notifUrl($tenant, '/api/v1/notification-templates'))
        ->assertOk()
        ->json('data');

    foreach ($templates as $template) {
        $body = mb_strtolower((string) $template['body']);

        if ($template['key'] === TemplateRegistry::RESULTS_AVAILABLE) {
            expect($body)->toContain('sign in')
                ->and($body)->toContain('{sign_in_link}')
                // Ready, and nothing about what they say.
                ->and($body)->not->toContain('positive')
                ->and($body)->not->toContain('negative');

            continue;
        }

        expect($body)->not->toContain('result', "Template [{$template['key']}] mentions a result");
    }
});

it('lists what the clinic sent, with the recipient masked', function () {
    // The history answers "was the patient told?". The body is returned because
    // what was actually sent is the fact in dispute; the number is masked so a
    // list endpoint cannot be used to enumerate the clinic's patients by phone.
    $tenant = Tenant::factory()->create();
    $admin = notifStaff($tenant, ClinicalRole::ClinicAdmin);

    $notification = app(Tenancy::class)->run(
        $tenant->id,
        fn () => OutboundNotification::factory()->sent()->create(['recipient' => '+256772123456']),
    );

    $response = $this->actingAs($admin)
        ->getJson(notifUrl($tenant, '/api/v1/notifications'))
        ->assertOk()
        ->assertJsonPath('data.0.id', $notification->id)
        ->assertJsonPath('data.0.template_key', TemplateRegistry::PRESCRIPTION_READY)
        ->assertJsonPath('data.0.status', 'sent');

    $body = json_encode($response->json()) ?: '';

    expect($body)->not->toContain('+256772123456')
        ->and($body)->not->toContain('772123456');
});

it('shows a clinic only its own send history', function () {
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $ofA = app(Tenancy::class)->run($tenantA->id, fn () => OutboundNotification::factory()->create());
    $ofB = app(Tenancy::class)->run($tenantB->id, fn () => OutboundNotification::factory()->create());

    $ids = $this->actingAs(notifStaff($tenantA, ClinicalRole::ClinicAdmin))
        ->getJson(notifUrl($tenantA, '/api/v1/notifications'))
        ->assertOk()
        ->json('data.*.id');

    expect($ids)->toContain($ofA->id)->not->toContain($ofB->id);
});

it('reports SMS consumption without claiming to hold anything', function () {
    // Counts of messages, never a stored figure. SMS is a metered pass-through
    // invoiced by the gateway; this platform holds nothing on the clinic's
    // behalf, and a number implying otherwise would be both false and a claim
    // of custody.
    $tenant = Tenant::factory()->create();
    $admin = notifStaff($tenant, ClinicalRole::ClinicAdmin);

    app(Tenancy::class)->run($tenant->id, function () {
        OutboundNotification::factory()->sent()->count(2)->create();
        OutboundNotification::factory()->failed('rate_limited')->create();
    });

    $response = $this->actingAs($admin)
        ->getJson(notifUrl($tenant, '/api/v1/sms-balance'))
        ->assertOk()
        ->assertJsonPath('data.sms.sent', 2)
        ->assertJsonPath('data.sms.failed', 1)
        ->assertJsonPath('data.sms.total', 3)
        // The operationally important number: a clinic seeing this rise is a
        // clinic whose reminders are silently not arriving.
        ->assertJsonPath('data.rate_limit.suppressed_this_period', 1);

    $body = strtolower(json_encode($response->json()) ?: '');

    foreach (['wallet', 'escrow', 'payout', 'settlement', 'balance'] as $forbidden) {
        expect($body)->not->toContain($forbidden, "The SMS report implies custody: '{$forbidden}'");
    }
});

it('refuses the whole notification surface to a pharmacist', function () {
    $tenant = Tenant::factory()->create();
    $pharmacist = notifStaff($tenant, ClinicalRole::Pharmacist);

    foreach (['/api/v1/notifications', '/api/v1/notification-templates', '/api/v1/sms-balance'] as $path) {
        $this->actingAs($pharmacist)
            ->getJson(notifUrl($tenant, $path))
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }
});
