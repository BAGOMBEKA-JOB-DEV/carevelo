<?php

use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| H1 -- the clinic configuring itself
|--------------------------------------------------------------------------
|
| Two acceptance criteria carry most of the risk here.
|
| "No tenant-supplied value can inject CSS, HTML or JavaScript into any
| rendered page. Covered by test with hostile inputs." Branding tokens end up
| in CSS custom properties on a page that displays another patient's dosage
| instructions, so a colour field is an XSS and exfiltration surface rather
| than a preference.
|
| "Compliance references are stored and displayed as unverified attestations."
| Carevelo has no access to the UMDPC or NDA registers. A response that could
| present a reference as checked would eventually be relied upon by a patient.
|
| See docs/10-product/prd-h1-clinic-onboarding.md and
| docs/10-product/white-labeling-and-branding.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

function h1TenantUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

function h1TenantStaff(Tenant $tenant, ClinicalRole $role): User
{
    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id]);
        $user->assignRole($role->value);

        return $user;
    });
}

/**
 * @param  array<string, mixed>  $attributes
 * @return array{Tenant, User}
 */
function h1TenantFixture(array $attributes = []): array
{
    $tenant = Tenant::factory()->create($attributes);

    return [$tenant, h1TenantStaff($tenant, ClinicalRole::ClinicAdmin)];
}

/**
 * The checklist items, keyed by their `key`, from a decoded response body.
 *
 * @return array<string, array<string, mixed>>
 */
function h1ChecklistByKey(mixed $items): array
{
    $keyed = [];

    foreach (is_array($items) ? $items : [] as $item) {
        if (is_array($item) && is_string($item['key'] ?? null)) {
            $keyed[$item['key']] = $item;
        }
    }

    return $keyed;
}

// --- Branding -------------------------------------------------------------

it('stores validated brand colours and computes a readable foreground', function () {
    [$tenant, $admin] = h1TenantFixture();

    $response = $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), [
            'primary_colour' => '#1B7F5A',
            'secondary_colour' => '#0F3D2E',
        ])
        ->assertOk()
        ->assertJsonPath('data.branding.primary_colour', '#1B7F5A');

    // Computed, never chosen. A clinic that picks pale yellow still gets
    // readable text, because an unreadable dosage instruction is a safety
    // problem rather than a taste problem.
    expect($response->json('data.branding.primary_foreground'))->toBe('#FFFFFF');

    expect($tenant->fresh()?->getAttribute('primary_colour'))->toBe('#1B7F5A');
});

it('advises on a colour too pale to carry the brand, without refusing it', function () {
    [$tenant, $admin] = h1TenantFixture();

    $response = $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['primary_colour' => '#FFFEF0'])
        ->assertOk();

    expect($response->json('data.branding.primary_foreground'))->toBe('#111111');
    expect($response->json('data.branding.contrast_advisories'))->not->toBeEmpty();
});

it('refuses a hostile colour value before it is ever stored', function (string $hostile) {
    // THE branding security test. Each of these is a real attempt to escape the
    // token and reach a stylesheet, a URL or a script context.
    [$tenant, $admin] = h1TenantFixture();

    $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['primary_colour' => $hostile])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    // Nothing reached the column. The refusal is on entry, not on render:
    // validating at render time leaves one careless template between this
    // string and script execution.
    expect($tenant->fresh()?->getAttribute('primary_colour'))->toBeNull();
})->with([
    '<script>alert(1)</script>',
    'red; background:url(https://evil.example/exfiltrate)',
    'javascript:alert(document.cookie)',
    '#1B7F5A; --brand-logo-url:url(https://evil.example/x)',
    'expression(alert(1))',
    'url(https://evil.example/x)',
    'rgb(27,127,90)',
    'red',
    // Six hex digits followed by a newline and a payload. PCRE lets `$` match
    // before a trailing newline unless the pattern says otherwise, so this is
    // the input that quietly passes a plausible-looking rule.
    "#1B7F5A\n; background:url(https://evil.example/x)",
    '#1B7F5',
    '#1B7F5AA',
    '1B7F5A',
    '#GGGGGG',
]);

it('re-encodes an uploaded logo server-side', function () {
    Storage::fake('public');

    [$tenant, $admin] = h1TenantFixture();

    // A JPEG goes in. A PNG comes out, because the bytes are decoded to a pixel
    // buffer and written fresh -- which is what discards EXIF blocks, colour
    // profiles, trailing bytes and any polyglot payload riding along in them.
    $this->actingAs($admin)
        ->post(h1TenantUrl($tenant, '/api/v1/tenant/logo'), [
            'logo' => UploadedFile::fake()->image('logo.jpg', 320, 320),
        ], ['Accept' => 'application/json'])
        ->assertOk();

    $path = $tenant->fresh()?->getAttribute('logo_path');

    expect($path)->toBeString()
        // Tenant-partitioned storage: one clinic's assets are not reachable
        // from another clinic's prefix.
        ->toStartWith('tenants/'.$tenant->id.'/branding/')
        ->toEndWith('.png');

    expect(Storage::disk('public')->exists((string) $path))->toBeTrue();
    expect(substr((string) Storage::disk('public')->get((string) $path), 0, 8))
        ->toBe("\x89PNG\r\n\x1a\n");
});

it('refuses a logo that fails validation', function (UploadedFile $file) {
    Storage::fake('public');

    [$tenant, $admin] = h1TenantFixture();

    $this->actingAs($admin)
        ->post(h1TenantUrl($tenant, '/api/v1/tenant/logo'), ['logo' => $file], ['Accept' => 'application/json'])
        ->assertStatus(422);

    expect($tenant->fresh()?->getAttribute('logo_path'))->toBeNull();
})->with([
    // Smaller than a favicon: renders as mush on the prescription PDF.
    'too small' => fn () => UploadedFile::fake()->image('logo.png', 32, 32),
    // Absurd for every surface the product has.
    'too large a canvas' => fn () => UploadedFile::fake()->image('logo.png', 2400, 2400),
    // A text file wearing an image name and MIME type. The declared type is a
    // claim by the uploader and is never trusted.
    'not an image at all' => fn () => UploadedFile::fake()->create('logo.png', 8, 'image/png'),
    'an svg, which is a script container' => fn () => UploadedFile::fake()->create('logo.svg', 4, 'image/svg+xml'),
]);

// --- The immutable subdomain ---------------------------------------------

it('cannot change the subdomain after provisioning', function () {
    [$tenant, $admin] = h1TenantFixture();

    $original = $tenant->subdomain;

    $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['subdomain' => 'somewhere-else'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation_failed');

    expect($tenant->fresh()?->subdomain)->toBe($original);
});

it('cannot change the slug or the status either', function (string $field, string $value) {
    [$tenant, $admin] = h1TenantFixture();

    $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), [$field => $value])
        ->assertStatus(422);
})->with([
    ['slug', 'somewhere-else'],
    ['custom_domain', 'evil.example'],
    ['status', 'active'],
    ['logo_path', '../../etc/passwd'],
]);

// --- Compliance references ----------------------------------------------

it('records compliance references as the clinic\'s own unverified attestation', function () {
    [$tenant, $admin] = h1TenantFixture();

    $response = $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), [
            'umdpc_facility_reference' => 'UMDPC-F-4821',
            'nda_licence_reference' => 'NDA-PH-00913',
        ])
        ->assertOk()
        ->assertJsonPath('data.compliance.umdpc_facility_reference', 'UMDPC-F-4821')
        // Not a column, and never true. Carevelo has no access to those
        // registers, and a patient must never be shown a badge implying it does.
        ->assertJsonPath('data.compliance.verified_by_carevelo', false);

    expect(strtolower((string) $response->json('data.compliance.attestation_note')))
        ->toContain('does not verify licences');

    // And nothing anywhere in the payload claims verification.
    expect(json_encode($response->json()) ?: '')->not->toContain('"verified":true');
});

// --- Onboarding checklist -----------------------------------------------

it('never marks the aggregator account as required', function () {
    // §H1.6. A clinic with no merchant account completes onboarding, holds
    // consultations and takes payment at the counter. Marking this required
    // would turn a commercial gap into a clinical blocker.
    [$tenant, $admin] = h1TenantFixture(['status' => TenantStatus::Provisioning]);

    $response = $this->actingAs($admin)
        ->getJson(h1TenantUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
        ->assertOk();

    $items = h1ChecklistByKey($response->json('data.items'));

    expect($items['aggregator_account']['is_required'])->toBeFalse();
    expect($items['aggregator_account']['is_complete'])->toBeFalse();
    expect($response->json('data.is_ready_to_activate'))->toBeFalse();
    expect(strtolower((string) $response->json('data.note')))->toContain('paid at the clinic');
});

it('activates the clinic once branding, a service, a clinician and consent text are in place', function () {
    [$tenant, $admin] = h1TenantFixture([
        'status' => TenantStatus::Provisioning,
        'logo_path' => 'tenants/seeded/branding/logo.png',
    ]);

    app(Tenancy::class)->run($tenant->id, function () {
        Service::factory()->create(['is_active' => true]);
        Clinician::factory()->create();
    });

    $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['primary_colour' => '#1B7F5A'])
        ->assertOk()
        ->assertJsonPath('data.status', TenantStatus::Active->value);

    expect($tenant->fresh()?->status)->toBe(TenantStatus::Active);

    $this->actingAs($admin)
        ->getJson(h1TenantUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
        ->assertOk()
        ->assertJsonPath('data.is_ready_to_activate', true);
});

// --- Authorisation -------------------------------------------------------

it('refuses every onboarding endpoint to a non-administrator', function (ClinicalRole $role) {
    $tenant = Tenant::factory()->create();
    $staff = h1TenantStaff($tenant, $role);

    $this->actingAs($staff)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['trading_name' => 'Renamed'])
        ->assertForbidden();

    $this->actingAs($staff)
        ->getJson(h1TenantUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
        ->assertForbidden();
})->with([
    ClinicalRole::Clinician,
    ClinicalRole::Pharmacist,
    ClinicalRole::FrontDesk,
    ClinicalRole::Dispatcher,
    ClinicalRole::Rider,
]);

it('refuses a deactivated administrator', function () {
    // Deactivation has to remove access at once. An administrator who was let
    // go last week must not still be able to repoint the clinic's branding.
    $tenant = Tenant::factory()->create();

    $admin = app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'is_active' => false]);
        $user->assignRole(ClinicalRole::ClinicAdmin->value);

        return $user;
    });

    $this->actingAs($admin)
        ->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['trading_name' => 'Renamed'])
        ->assertForbidden();
});

it('refuses an unauthenticated request', function () {
    $tenant = Tenant::factory()->create();

    $this->patchJson(h1TenantUrl($tenant, '/api/v1/tenant'), ['trading_name' => 'Renamed'])
        ->assertUnauthorized();

    $this->getJson(h1TenantUrl($tenant, '/api/v1/tenant/onboarding-checklist'))
        ->assertUnauthorized();
});
