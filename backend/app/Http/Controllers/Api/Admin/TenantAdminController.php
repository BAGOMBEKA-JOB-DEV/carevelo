<?php

namespace App\Http\Controllers\Api\Admin;

use App\Audit\AuditLog;
use App\Http\Controllers\Api\V1\ConsentController;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Tenant\UpdateTenantRequest;
use App\Http\Requests\Admin\Tenant\UploadLogoRequest;
use App\Http\Resources\V1\TenantAdminResource;
use App\Models\AggregatorAccount;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Service;
use App\Models\StaffInvitation;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * H1 clinic onboarding: the clinic configuring itself.
 *
 * The target from §K is first contact to first consultation in under one day,
 * unassisted. That number is only reachable if every step here is
 * self-service -- so nothing in this controller requires Carevelo staff, and
 * nothing in it blocks care. A clinic can reach `active` and hold a real
 * consultation with no logo, no compliance references and no merchant account.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 * @see docs/10-product/white-labeling-and-branding.md
 */
class TenantAdminController extends Controller
{
    /**
     * Branding assets are served to the patient portal, so they live on the
     * public disk under a tenant-partitioned prefix.
     */
    public const LOGO_DISK = 'public';

    public function __construct(protected AuditLog $audit) {}

    /**
     * Branding, contact details and compliance references.
     *
     * The subdomain cannot be changed here and the request says so explicitly
     * rather than discarding it -- see UpdateTenantRequest.
     */
    public function update(UpdateTenantRequest $request): TenantAdminResource
    {
        $tenant = $this->administeredTenant($request);

        $changes = $request->validated();

        $tenant->fill($changes)->save();

        $this->audit->record(
            'tenant.updated',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
            // Which fields moved, never their values. A clinic's contact
            // details are personal data and an audit trail is read by more
            // people, for longer, than the record itself.
            metadata: ['fields' => array_keys($changes)],
        );

        $this->activateWhenReady($tenant);

        return new TenantAdminResource($tenant);
    }

    /**
     * Replace the clinic's logo.
     *
     * The upload is decoded and RE-ENCODED server-side. The declared MIME type
     * is a claim by the uploader, and an image is a container: EXIF blocks,
     * colour profiles and trailing bytes all survive a naive copy, and a file
     * that is a valid image AND a valid script is a well-worn trick. Decoding
     * to a pixel buffer and writing a fresh PNG discards everything that is not
     * an image, including the metadata the branding document requires us to
     * strip.
     */
    public function uploadLogo(UploadLogoRequest $request): TenantAdminResource
    {
        $tenant = $this->administeredTenant($request);

        $upload = $request->file('logo');

        if (! $upload instanceof UploadedFile) {
            throw ValidationException::withMessages(['logo' => 'Attach the logo as a single file.']);
        }

        $png = $this->reencodeAsPng($upload);

        // Tenant-partitioned, and named with a fresh ULID rather than the
        // uploaded filename: the filename is attacker-controlled text, and a
        // predictable path lets one clinic guess another's asset URL.
        $path = sprintf('tenants/%s/branding/%s.png', $tenant->id, Str::ulid());

        Storage::disk(self::LOGO_DISK)->put($path, $png);

        $previous = $tenant->logo_path;
        $tenant->logo_path = $path;
        $tenant->save();

        if (is_string($previous) && $previous !== '') {
            Storage::disk(self::LOGO_DISK)->delete($previous);
        }

        $this->audit->record(
            'tenant.logo_updated',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
        );

        $this->activateWhenReady($tenant);

        return new TenantAdminResource($tenant);
    }

    /**
     * What remains before the clinic is live.
     *
     * The aggregator account is present and NOT required. §H1.6 is explicit:
     * a clinic without a merchant account completes onboarding, runs
     * consultations and takes payment at the counter. Marking it required would
     * turn a commercial gap into a clinical blocker.
     */
    public function checklist(Request $request): JsonResponse
    {
        $tenant = $this->administeredTenant($request);

        $items = $this->checklistItems($tenant);

        $outstanding = array_values(array_filter(
            $items,
            static fn (array $item): bool => $item['is_required'] && ! $item['is_complete'],
        ));

        return response()->json([
            'data' => [
                'tenant_status' => $tenant->status->value,
                'items' => $items,
                'is_ready_to_activate' => $outstanding === [],
                'note' => 'A clinic with no aggregator account can finish onboarding and hold '
                    .'consultations. Those appointments are paid at the clinic.',
            ],
        ]);
    }

    /**
     * The checklist, evaluated.
     *
     * `is_required` marks the four gates the PRD names for activation. The rest
     * are recommendations, and the distinction is the difference between a
     * clinic that goes live today and one that waits for its NDA paperwork.
     *
     * @return list<array{key: string, label: string, is_complete: bool, is_required: bool, detail: ?string}>
     */
    private function checklistItems(Tenant $tenant): array
    {
        $hasBranding = $tenant->primary_colour !== null && $tenant->logo_path !== null;
        $hasServices = Service::query()->where('is_active', true)->exists();
        $hasClinicians = Clinician::query()->exists();
        // An invitation that has been sent counts. The administrator has done
        // their part, and a checklist that only ticks once colleagues accept
        // reads as a failure of the administrator rather than a wait.
        $hasStaff = User::query()->where('tenant_id', $tenant->id)->where('is_active', true)->count() > 1
            || StaffInvitation::query()->whereNull('accepted_at')->exists();
        $hasCompliance = $tenant->umdpc_facility_reference !== null && $tenant->nda_licence_reference !== null;

        return [
            [
                'key' => 'branding',
                'label' => 'Logo and brand colours',
                'is_complete' => $hasBranding,
                'is_required' => true,
                'detail' => null,
            ],
            [
                'key' => 'services',
                'label' => 'At least one bookable service, with the clinic\'s own price',
                'is_complete' => $hasServices,
                'is_required' => true,
                'detail' => null,
            ],
            [
                'key' => 'clinicians',
                'label' => 'At least one registered clinician',
                'is_complete' => $hasClinicians,
                'is_required' => true,
                'detail' => null,
            ],
            [
                // Platform-provided and versioned. The clinic may extend the
                // wording but cannot remove the mandatory DPPA elements, so
                // this gate is satisfied the moment the tenant exists.
                'key' => 'consent_templates',
                'label' => 'Patient consent text and privacy notice',
                'is_complete' => true,
                'is_required' => true,
                'detail' => 'Policy version '.ConsentController::POLICY_VERSION.'.',
            ],
            [
                'key' => 'compliance_references',
                'label' => 'UMDPC facility reference and NDA pharmacy licence reference',
                'is_complete' => $hasCompliance,
                'is_required' => false,
                'detail' => 'Recorded as the clinic\'s own attestation. Carevelo does not verify licences '
                    .'and has no access to those registers.',
            ],
            [
                'key' => 'staff',
                'label' => 'Colleagues invited',
                'is_complete' => $hasStaff,
                'is_required' => false,
                'detail' => null,
            ],
            [
                'key' => 'aggregator_account',
                'label' => 'The clinic\'s own mobile-money account connected',
                'is_complete' => $this->hasUsableAggregatorAccount(),
                'is_required' => false,
                'detail' => 'Optional. Without it, appointments are paid at the clinic and everything '
                    .'else works unchanged.',
            ],
        ];
    }

    /**
     * Read through the same query the payment path uses, so the checklist cannot
     * claim a connection the collection code would not accept.
     */
    private function hasUsableAggregatorAccount(): bool
    {
        return AggregatorAccount::query()->where('status', 'active')->exists();
    }

    /**
     * Move a provisioning clinic to `active` once its four gates are met.
     *
     * Done on a write rather than on the checklist read: a GET that changes
     * state is a GET that changes state when a console polls it, and the
     * transition emits an audit event that should have a cause.
     */
    private function activateWhenReady(Tenant $tenant): void
    {
        if ($tenant->status !== TenantStatus::Provisioning) {
            return;
        }

        foreach ($this->checklistItems($tenant) as $item) {
            if ($item['is_required'] && ! $item['is_complete']) {
                return;
            }
        }

        $tenant->status->assertCanTransitionTo(TenantStatus::Active);
        $tenant->status = TenantStatus::Active;
        $tenant->save();

        $this->audit->record(
            'tenant.activated',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
        );
    }

    /**
     * Decode the upload and write a fresh PNG.
     *
     * @throws ValidationException when the bytes are not a readable image
     */
    private function reencodeAsPng(UploadedFile $upload): string
    {
        $bytes = (string) file_get_contents($upload->getRealPath());

        // Suppressed deliberately: a malformed image is ordinary user input,
        // and GD's warning would land in the log with the tenant's filename.
        $image = @imagecreatefromstring($bytes);

        if ($image === false) {
            throw ValidationException::withMessages([
                'logo' => 'That file could not be read as an image. Upload a PNG, JPEG or WebP.',
            ]);
        }

        imagealphablending($image, false);
        imagesavealpha($image, true);

        ob_start();
        imagepng($image);
        $png = (string) ob_get_clean();
        imagedestroy($image);

        return $png;
    }

    /**
     * The clinic this administrator may configure.
     *
     * There is no TenantPolicy to consult: the tenant register is
     * platform-scoped, has no `tenant_id` and is not subject to row-level
     * security, so "may this user administer this clinic" is a question about
     * the resolved host and the user's role rather than about a record. The
     * check is written out here so that reading the controller tells you the
     * whole answer.
     *
     * The tenant comes from ResolveTenant -- the request host -- and never from
     * the payload.
     *
     * @throws AuthorizationException
     */
    private function administeredTenant(Request $request): Tenant
    {
        $tenant = $request->attributes->get('tenant');
        $user = $request->user();

        if (! $tenant instanceof Tenant
            || ! $user instanceof User
            || ! $user->is_active
            || ! $user->belongsToTenant($tenant->id)
            || ! $user->hasRole(ClinicalRole::ClinicAdmin->value)) {
            throw new AuthorizationException;
        }

        return $tenant;
    }
}
