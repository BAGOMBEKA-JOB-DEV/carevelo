<?php

namespace App\Jobs;

use App\Models\Prescription;
use App\Services\Documents\PrescriptionDocuments;

/**
 * Renders a prescription document, in the tenant's context.
 *
 * Extends TenantAwareJob because it must. By the time a worker picks this up,
 * the request that knew the tenant is gone; without the tenant captured at
 * construction, row-level security returns nothing and the job renders a
 * document for a prescription it cannot see. Only the identifier is carried --
 * serialising the model would drag a clinical record through the queue payload.
 *
 * NOTE — this job cannot yet survive a queue payload round trip, and neither
 * can any other TenantAwareJob. TenantAwareJob::$tenantId is `public readonly`,
 * and PHP scopes a reflective readonly initialisation to the OBJECT's class
 * rather than the declaring one, so SerializesModels::__unserialize() -- which
 * reflects over `new ReflectionClass($this)` -- throws "Cannot initialize
 * readonly property App\Jobs\TenantAwareJob::$tenantId from scope <subclass>"
 * on every driver that serialises, which is all of them. It has stayed
 * invisible because every existing suite fakes the queue rather than round
 * tripping a payload. Dropping `readonly` from the base property fixes it;
 * reported to the owner of that file, which this module does not own.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
final class RenderPrescriptionDocumentJob extends TenantAwareJob
{
    public function __construct(public readonly string $prescriptionId)
    {
        parent::__construct();
    }

    protected function handleForTenant(): void
    {
        $prescription = Prescription::query()->find($this->prescriptionId);

        // A prescription that is not there is not an error worth retrying: with
        // the tenant bound correctly, absent means absent.
        if ($prescription === null) {
            return;
        }

        app(PrescriptionDocuments::class)->render($prescription);
    }
}
