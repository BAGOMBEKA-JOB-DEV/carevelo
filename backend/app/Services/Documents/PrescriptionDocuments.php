<?php

namespace App\Services\Documents;

use App\Audit\AuditLog;
use App\Jobs\RenderPrescriptionDocumentJob;
use App\Models\Prescription;
use App\Models\Tenant;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Storage, disclosure and verification of prescription documents.
 *
 * Three properties hold this together:
 *
 *   1. The bytes live on a PRIVATE disk under a tenant-partitioned, ULID-named
 *      path. There is no public route to them and no path worth guessing.
 *   2. A reader receives a SHORT-LIVED SIGNED URL, issued only after the
 *      caller has been authorised against the prescription.
 *   3. document_hash lets any holder of the record prove the file they were
 *      given is the document that record describes.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md section 6
 */
final class PrescriptionDocuments
{
    /**
     * How long a link lives.
     *
     * The URL is a bearer credential for special-category health data: whoever
     * holds it reads the document. Five minutes is long enough to open the file
     * and short enough that a link forwarded into a family WhatsApp group is
     * already dead when it arrives.
     */
    public const LINK_TTL_SECONDS = 300;

    /**
     * The private disk. Never 'public' -- a prescription served from a static
     * path is a prescription served to anyone who finds the path.
     */
    public const DISK = 'local';

    public const HASH_ALGORITHM = 'sha256';

    public function __construct(
        private readonly PrescriptionRenderer $renderer,
        private readonly AuditLog $audit,
    ) {}

    /**
     * Issue a link to the document, rendering it first if it does not exist.
     *
     * The caller has already been authorised by the controller. Nothing in here
     * creates a URL before that check has happened.
     */
    public function linkResponse(Prescription $prescription): JsonResponse
    {
        $path = $this->storedPath($prescription);

        if ($path === null) {
            RenderPrescriptionDocumentJob::dispatch($prescription->id);

            // The render may already be done -- inline on a synchronous queue,
            // or simply quick. Re-reading lets this request hand back the link
            // instead of making the client poll for a file that now exists.
            $prescription->refresh();
            $path = $this->storedPath($prescription);
        }

        if ($path === null) {
            return new JsonResponse(
                ['data' => ['status' => 'rendering']],
                Response::HTTP_ACCEPTED,
            );
        }

        $expiresAt = Date::now()->addSeconds(self::LINK_TTL_SECONDS);

        $url = $this->disk()->temporaryUrl($path, $expiresAt);

        // A clinical document leaving the building is a disclosure, so it is
        // audited. Identifiers and the expiry only: the storage path would
        // outlive the link and belongs nowhere near an audit trail, and what the
        // document SAYS belongs only on the document.
        $this->audit->record('prescription.document_issued', 'Prescription', $prescription->id, [
            'expires_at' => $expiresAt->toIso8601String(),
            'ttl_seconds' => self::LINK_TTL_SECONDS,
        ]);

        return new JsonResponse(['data' => [
            'url' => $url,
            'expires_at' => $expiresAt->toIso8601String(),
            'document_hash' => $prescription->getAttribute('document_hash'),
            'hash_algorithm' => self::HASH_ALGORITHM,
        ]]);
    }

    /**
     * Render and store the document. Called from the queue, never from a
     * request handler.
     */
    public function render(Prescription $prescription): void
    {
        // Rendered once and only once. A prescription is immutable, so its
        // document is too, and re-rendering would replace a file somebody has
        // already been handed the hash of.
        if ($this->storedPath($prescription) !== null) {
            return;
        }

        $bytes = $this->renderer->render($this->describe($prescription));

        $path = sprintf(
            '%s/prescriptions/%s/%s.%s',
            $prescription->tenant_id,
            $prescription->id,
            Str::ulid()->toString(),
            $this->renderer->extension(),
        );

        $this->disk()->put($path, $bytes);

        $prescription->update([
            'document_path' => $path,
            'document_hash' => hash(self::HASH_ALGORITHM, $bytes),
        ]);

        $this->audit->record('prescription.document_rendered', 'Prescription', $prescription->id);
    }

    /**
     * Does the stored file still say what the record says?
     *
     * Re-renders from the record and compares both the recorded hash and the
     * bytes on disk against it. Because the renderer is deterministic, a
     * mismatch is a real finding rather than noise: a substituted file, a
     * truncated write, or a record altered underneath a document already in
     * somebody's hands.
     */
    public function verify(Prescription $prescription): bool
    {
        $path = $this->storedPath($prescription);
        $recorded = $prescription->getAttribute('document_hash');

        if ($path === null || ! is_string($recorded)) {
            return false;
        }

        $stored = $this->disk()->get($path);

        if ($stored === null) {
            return false;
        }

        $expected = hash(self::HASH_ALGORITHM, $this->renderer->render($this->describe($prescription)));

        return hash_equals($expected, $recorded)
            && hash_equals($expected, hash(self::HASH_ALGORITHM, $stored));
    }

    private function describe(Prescription $prescription): PrescriptionDocument
    {
        // The tenant register is platform-scoped, so this is a lookup by the
        // prescription's own tenant_id rather than anything the caller supplied.
        $tenant = Tenant::query()->findOrFail($prescription->tenant_id);

        return PrescriptionDocument::for($prescription, $tenant);
    }

    private function storedPath(Prescription $prescription): ?string
    {
        $path = $prescription->getAttribute('document_path');

        return is_string($path) && $path !== '' ? $path : null;
    }

    private function disk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk(self::DISK);

        return $disk;
    }
}
