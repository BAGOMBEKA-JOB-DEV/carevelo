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
