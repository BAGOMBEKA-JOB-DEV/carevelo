<?php

use App\Jobs\RenderPrescriptionDocumentJob;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Documents\PrescriptionDocuments;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| The prescription document -- H3 section 6
|--------------------------------------------------------------------------
|
| Four properties are load-bearing and each is asserted below:
|
|   1. The bytes are reachable only through a SHORT-LIVED SIGNED URL issued
|      after an authorisation check. Never a public or guessable path.
|   2. Rendering happens in a TenantAwareJob, on a tenant-partitioned path. A
|      job without tenant context sees nothing under row-level security -- or,
|      if the application role ever comes to own the tables, sees everything.
|   3. document_hash verifies the file against the record it claims to be.
|   4. The clinician and the clinic are named. CAREVELO IS NOT. The prescription
|      is a clinical act by a licensed clinician of the clinic, and a supplier's
|      name on the page would misstate who is answerable for it.
|
| Two deliberate choices about the test harness:
|
|   Storage::fake() is unusable here -- it replaces temporaryUrl() with an
|   UNSIGNED stub, which would make the signature and expiry assertions prove
|   nothing. The real local driver is used instead, with its root redirected
|   into the testing directory and cleaned between tests.
|
|   The queue is faked and the job is then run in process, rather than let the
|   synchronous driver round trip the payload. See the NOTE on
|   RenderPrescriptionDocumentJob: no TenantAwareJob currently survives
|   unserialisation, which is a defect in a base class this module does not own.
|
| See docs/10-product/prd-h3-teleconsultation.md
|
*/

const DOCUMENT_TEST_DISK_ROOT = 'framework/testing/disks/prescription-documents';

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    Queue::fake();

    config(['filesystems.disks.local.root' => storage_path(DOCUMENT_TEST_DISK_ROOT)]);
    Storage::forgetDisk('local');

    File::deleteDirectory(storage_path(DOCUMENT_TEST_DISK_ROOT));
});

afterEach(function () {
    File::deleteDirectory(storage_path(DOCUMENT_TEST_DISK_ROOT));
});

function documentUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A clinic, a clinician of it, and one issued prescription.
 *
 * Branding is set explicitly rather than left to the factory, so the assertion
 * that the clinic heads the document tests the document and not faker.
 *
 * @return array{Tenant, User, Prescription}
 */
function documentFixture(bool $controlled = false): array
{
    $tenant = Tenant::factory()->create([
        'trading_name' => 'Bugolobi Family Clinic',
        'legal_name' => 'Bugolobi Family Clinic Limited',
        'physical_address' => 'Plot 14, Luthuli Avenue',
        'district' => 'Kampala',
        'contact_phone' => '+256772000111',
        'umdpc_facility_reference' => 'UMDPC-FAC-4417',
    ]);

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant, $controlled) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'name' => 'Dr Amina Nakato']);
        $user->assignRole(ClinicalRole::Clinician->value);

        $clinician = Clinician::factory()->create([
            'user_id' => $user->id,
            'registration_number' => 'UMDPC-77321',
            'registration_body' => 'umdpc',
        ]);

        $prescription = Prescription::factory()->create([
            'clinician_id' => $clinician->id,
            'patient_id' => Patient::factory()->create()->id,
            'consultation_id' => Consultation::factory()->create([
                'clinician_id' => $clinician->id,
            ])->id,
            'clinician_name_snapshot' => 'Dr Amina Nakato',
            'clinician_registration_snapshot' => 'UMDPC-77321',
            'registration_body_snapshot' => 'umdpc',
        ]);

        PrescriptionItem::factory()->create([
            'prescription_id' => $prescription->id,
            'medicine_name' => $controlled ? 'Pethidine' : 'Amoxicillin',
            'strength' => '500mg',
            'is_controlled' => $controlled,
        ]);

        return [$tenant, $user, $prescription];
    });
}

/** Do what a queue worker would do, in the tenant's context. */
function renderPrescriptionDocument(Tenant $tenant, Prescription $prescription): void
{
    app(Tenancy::class)->run($tenant->id, function () use ($prescription) {
        (new RenderPrescriptionDocumentJob($prescription->id))->handle();
    });
}

/** The prescription as the tenant's own connection sees it. */
function refreshPrescription(Tenant $tenant, Prescription $prescription): Prescription
{
    return app(Tenancy::class)->run(
        $tenant->id,
        fn () => Prescription::query()->findOrFail($prescription->id)
    );
}

// --- 1. A signed URL, issued only after authorisation ----------------------

it('issues a short-lived signed link once the caller is authorised', function () {
    [$tenant, $user, $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    $response = $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk()
        ->assertJsonStructure(['data' => ['url', 'expires_at', 'document_hash', 'hash_algorithm']]);

    $url = (string) $response->json('data.url');

    // Signed and time-boxed. The signature is what makes the URL safe to hand
    // to a browser; the expiry is what makes it safe to hand to a phone. And
    // the path is not guessable -- tenant, prescription and a ULID -- on a
    // private disk with no public route to it.
    expect($url)->toContain('signature=')
        ->toContain('expires=')
        ->toContain($tenant->id)
        ->toContain($prescription->id)
        ->and($response->json('data.expires_at'))->not->toBeNull();

    expect($url)->not->toContain('/public/');

    expect($this->get($url)->assertOk()->streamedContent())->toStartWith('%PDF-');
});

it('refuses an unauthenticated request for the document', function () {
    // No session, no link. The URL is produced by an authorisation check, so
    // there is nothing to leak before one has happened.
    [$tenant, , $prescription] = documentFixture();

    $this->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertStatus(401)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'unauthenticated');

    // Nor could an unauthenticated caller make the platform produce the file.
    expect(refreshPrescription($tenant, $prescription)->getAttribute('document_path'))->toBeNull();
    Queue::assertNothingPushed();
});

it('stops serving the document once the link expires', function () {
    [$tenant, $user, $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    $url = (string) $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk()
        ->json('data.url');

    $this->get($url)->assertOk();

    // Past the TTL the same URL is dead, so a link forwarded into a family chat
    // is not a standing grant to read somebody's prescription.
    $this->travel(PrescriptionDocuments::LINK_TTL_SECONDS + 60)->seconds();

    // The refusal comes from the storage disk's own signed-URL route, which is NOT
    // under api/* and so is not covered by the API's problem+json renderers. The
    // status is the whole assertion here, deliberately.
    $this->get($url)->assertForbidden();
});

it('returns 404, not 403, for a prescription belonging to another clinic', function () {
    // A 403 would confirm the prescription exists, which discloses that someone
    // is a patient of another clinic.
    [$tenant, , $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    [$otherTenant, $otherUser] = documentFixture();

    $this->actingAs($otherUser)
        ->getJson(documentUrl($otherTenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertNotFound()
        ->assertJsonPath('code', 'not_found');
});

// --- 2. Rendered by a tenant-aware job, stored tenant-partitioned ---------

it('queues the render with the tenant captured, and answers 202 meanwhile', function () {
    [$tenant, $user, $prescription] = documentFixture();

    $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertStatus(202)
        ->assertJsonPath('data.status', 'rendering');

    // The tenant is captured at CONSTRUCTION, inside the request that knows it.
    // Resolving it in the worker would be resolving from nothing, and the tag is
    // how a tenant's jobs are found without a cross-tenant query.
    Queue::assertPushed(
        RenderPrescriptionDocumentJob::class,
        fn (RenderPrescriptionDocumentJob $job) => $job->prescriptionId === $prescription->id
            && $job->tenantId === $tenant->id
            && in_array('tenant:'.$tenant->id, $job->tags(), true),
    );
});

it('stores the document on a tenant-partitioned path', function () {
    [$tenant, , $prescription] = documentFixture();

    renderPrescriptionDocument($tenant, $prescription);

    $path = (string) refreshPrescription($tenant, $prescription)->getAttribute('document_path');

    expect($path)->toMatch(
        sprintf('#^%s/prescriptions/%s/[0-9A-HJKMNP-TV-Z]{26}\.pdf$#', $tenant->id, $prescription->id)
    );

    Storage::disk(PrescriptionDocuments::DISK)->assertExists($path);
});

it('renders once, so the document a hash was published for is never replaced', function () {
    [$tenant, $user, $prescription] = documentFixture();

    renderPrescriptionDocument($tenant, $prescription);
    // A second worker, a retry, or a second reader must not produce a new file.
    renderPrescriptionDocument($tenant, $prescription);

    $url = documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document");

    $first = $this->actingAs($user)->getJson($url)->assertOk();
    $second = $this->actingAs($user)->getJson($url)->assertOk();

    expect($second->json('data.document_hash'))->toBe($first->json('data.document_hash'));

    Storage::disk(PrescriptionDocuments::DISK)
        ->assertCount("{$tenant->id}/prescriptions/{$prescription->id}", 1);
});

// --- 3. The hash verifies the file against the record ---------------------

it('stores a hash that verifies the rendered file against the record', function () {
    [$tenant, $user, $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    $published = (string) $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk()
        ->json('data.document_hash');

    app(Tenancy::class)->run($tenant->id, function () use ($prescription, $published) {
        $fresh = Prescription::query()->findOrFail($prescription->id);
        $path = (string) $fresh->getAttribute('document_path');
        $bytes = (string) Storage::disk(PrescriptionDocuments::DISK)->get($path);

        // The published hash is the hash of the bytes on disk...
        expect(hash(PrescriptionDocuments::HASH_ALGORITHM, $bytes))->toBe($published)
            ->and($fresh->getAttribute('document_hash'))->toBe($published)
            // ...and re-deriving the document from the record reproduces it,
            // which is what makes this a verification and not a checksum.
            ->and(app(PrescriptionDocuments::class)->verify($fresh))->toBeTrue();
    });
});

it('fails verification when the stored file is not the document the record describes', function () {
    [$tenant, , $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    app(Tenancy::class)->run($tenant->id, function () use ($prescription) {
        $fresh = Prescription::query()->findOrFail($prescription->id);
        $path = (string) $fresh->getAttribute('document_path');

        // A substituted file: same path, same recorded hash, different bytes.
        Storage::disk(PrescriptionDocuments::DISK)->put($path, '%PDF-1.4 not the prescription');

        expect(app(PrescriptionDocuments::class)->verify($fresh))->toBeFalse();
    });
});

// --- 4. The clinician and the clinic. Never Carevelo ----------------------

it('carries the clinician snapshot and the clinic branding', function () {
    [$tenant, $user, $prescription] = documentFixture(controlled: true);
    renderPrescriptionDocument($tenant, $prescription);

    $url = (string) $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk()
        ->json('data.url');

    $rendered = $this->get($url)->assertOk()->streamedContent();

    expect($rendered)
        // The clinician's own name and registration, snapshotted at issue.
        ->toContain('Dr Amina Nakato')
        ->toContain('UMDPC-77321')
        ->toContain('UMDPC registration')
        // The clinic's branding: it is the issuing facility.
        ->toContain('BUGOLOBI FAMILY CLINIC')
        ->toContain('Plot 14, Luthuli Avenue')
        ->toContain('+256772000111')
        ->toContain('UMDPC-FAC-4417')
        // A controlled item is flagged on the page: it is handed over in person
        // and never enters the delivery flow.
        ->toContain('CONTROLLED');
});

it('names Carevelo nowhere on the document', function () {
    // Acceptance criterion 3. Carevelo is a software supplier and a data
    // processor; it issues nothing. The producer and creator fields are checked
    // too, because that is where a PDF library would quietly write its own name.
    [$tenant, $user, $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    $url = (string) $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk()
        ->json('data.url');

    $rendered = strtolower($this->get($url)->assertOk()->streamedContent());

    foreach (['carevelo', '/producer', '/creator', '/info'] as $forbidden) {
        expect(str_contains($rendered, $forbidden))->toBeFalse("The rendered prescription contained '{$forbidden}'");
    }
});

it('keeps the snapshot even after the clinician record changes', function () {
    // The document must keep saying what it said on the day it was issued. The
    // snapshot on the record is the source, never a join to a live row.
    [$tenant, $user, $prescription] = documentFixture();

    app(Tenancy::class)->run($tenant->id, function () {
        Clinician::query()->firstOrFail()->update(['registration_number' => 'UMDPC-00000']);
    });

    renderPrescriptionDocument($tenant, $prescription);

    $url = (string) $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk()
        ->json('data.url');

    $rendered = $this->get($url)->assertOk()->streamedContent();

    expect($rendered)->toContain('UMDPC-77321');
    expect($rendered)->not->toContain('UMDPC-00000');
});

// --- Audit -----------------------------------------------------------------

it('audits the disclosure with identifiers only, never the content or the path', function () {
    [$tenant, $user, $prescription] = documentFixture();
    renderPrescriptionDocument($tenant, $prescription);

    $this->actingAs($user)
        ->getJson(documentUrl($tenant, "/api/v1/prescriptions/{$prescription->id}/document"))
        ->assertOk();

    app(Tenancy::class)->run($tenant->id, function () use ($prescription) {
        $events = AuditEvent::query()
            ->whereIn('action', ['prescription.document_rendered', 'prescription.document_issued'])
            ->get();

        expect($events)->toHaveCount(2)
            ->and($events->pluck('subject_id')->unique()->all())->toBe([$prescription->id]);

        $recorded = strtolower(json_encode($events->toArray()) ?: '');

        // Not the medicine, and not the storage path -- the path outlives the
        // link, and an audit trail is no place to keep a route to a clinical
        // document.
        foreach (['amoxicillin', 'capsule', 'directions', '.pdf'] as $forbidden) {
            expect(str_contains($recorded, $forbidden))->toBeFalse("The audit event leaked '{$forbidden}'");
        }
    });
});
