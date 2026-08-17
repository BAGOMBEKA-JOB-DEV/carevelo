<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\PrescriptionIssued;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Api\V1\Concerns\AuthorisesPatientReads;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Prescriptions\CancelPrescriptionRequest;
use App\Http\Requests\V1\Prescriptions\IndexPrescriptionRequest;
use App\Http\Requests\V1\Prescriptions\StorePrescriptionRequest;
use App\Http\Resources\V1\PrescriptionResource;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\Prescription;
use App\Services\Documents\PrescriptionDocuments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

/**
 * E-prescribing.
 *
 * Carevelo does not issue prescriptions. This controller records what a
 * licensed clinician of the clinic decided, and renders it back under that
 * clinician's own name and registration number. It does not decide, suggest,
 * validate or endorse — there is no dosage check, no interaction check and no
 * substitution advice here, and their absence is deliberate.
 *
 * There is no update method, and no route that would reach one. A prescription
 * is corrected by cancelling it and issuing a replacement.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md section 6
 */
class PrescriptionController extends Controller
{
    use AuthorisesPatientReads;

    public function index(IndexPrescriptionRequest $request, AuditLog $audit): AnonymousResourceCollection
    {
        // Authorises AND narrows: a patient gets only their own prescriptions.
        // The patient_id filter below then intersects with that, so passing
        // someone else's id returns nothing rather than their records.
        $query = $this->authoriseListing(
            Prescription::query()->with('items'),
            $request->user(),
            Prescription::class,
        );

        $patientId = $request->patientId();

        if ($patientId !== null) {
            $query->where('patient_id', $patientId);
        }

        $status = $request->status();

        if ($status !== null) {
            $query->where('status', $status);
        }

        // Cursor, not offset: a queue paged through while new prescriptions
        // arrive shows duplicates and skips rows under offsets, and a skipped
        // row here is a prescription nobody dispenses. The id tiebreak keeps
        // the cursor stable when two are issued in the same second.
        $prescriptions = $query
            ->orderByDesc('issued_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage());

        // Reads of clinical records are audited as well as writes: "who looked
        // at my records?" can only be answered by having recorded every look.
        $audit->record('prescription.list_read', metadata: [
            'patient_id' => $patientId,
            'returned' => $prescriptions->count(),
        ]);

        return PrescriptionResource::collection($prescriptions);
    }

    public function store(StorePrescriptionRequest $request, AuditLog $audit): JsonResponse
    {
        $this->authorize('create', Prescription::class);

        // findOrFail, so a consultation belonging to another clinic returns
        // 404 rather than 403 — RLS has already made the row invisible, and a
        // 403 would confirm it exists.
        $consultation = Consultation::query()->findOrFail($request->consultationId());

        $clinician = $this->prescribingClinician($request);
        $items = $request->items();

        // The two hard preconditions live in the model, not here. An
        // IllegalTransition renders as 409 problem+json.
        $prescription = Prescription::issue($consultation, $clinician, $items);

        // Identifiers and counts only. What was prescribed is on the record,
        // never in the audit trail.
        $audit->record('prescription.issued', 'Prescription', $prescription->id, [
            'consultation_id' => $consultation->id,
            'clinician_id' => $clinician->id,
            'patient_id' => $prescription->getAttribute('patient_id'),
            'item_count' => count($items),
        ]);

        // The pharmacy queue is a live view: a pharmacist watching the screen
        // sees the order arrive without reloading. The frame carries the
        // prescription identifier only -- never a medicine name.
        event(PrescriptionIssued::from($prescription));

        return PrescriptionResource::make($prescription->load('items'))
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    public function show(Prescription $prescription, AuditLog $audit): PrescriptionResource
    {
        $this->authorize('view', $prescription);

        $audit->record('prescription.read', 'Prescription', $prescription->id);

        return PrescriptionResource::make($prescription->load('items'));
    }

    /**
     * Issue a short-lived signed link to the rendered document.
     *
     * The authorisation check happens HERE, before any URL exists. The document
     * itself never sits at a public or guessable path, so this endpoint is the
     * only way to reach one.
     */
    public function document(Prescription $prescription, PrescriptionDocuments $documents): JsonResponse
    {
        $this->authorize('view', $prescription);

        return $documents->linkResponse($prescription);
    }

    /**
     * Cancel a prescription.
     *
     * The only mutation this resource permits, and it adds rather than
     * overwrites: the status changes and the reason is recorded, while what was
     * prescribed stays exactly as issued.
     */
    public function cancel(
        CancelPrescriptionRequest $request,
        Prescription $prescription,
        AuditLog $audit,
    ): PrescriptionResource {
        $this->authorize('cancel', $prescription);

        // Cancelling twice is an IllegalTransition from the state machine, and
        // renders as 409.
        $prescription->cancel($request->reason());

        // The reason is clinician free text and may name a medicine or a
        // condition, so it stays on the record and out of the audit event.
        $audit->record('prescription.cancelled', 'Prescription', $prescription->id);

        return PrescriptionResource::make($prescription->load('items'));
    }

    /**
     * The clinician doing the prescribing is the authenticated user, always.
     *
     * A staff account with the clinician role but no Clinician record has no
     * registration number and therefore no standing to prescribe. Refusing
     * with the same 409 as the other prescribing refusals keeps the boundary
     * legible: prescribing is a clinical act by a registered clinician of the
     * clinic, or it does not happen.
     */
    protected function prescribingClinician(Request $request): Clinician
    {
        $clinician = Clinician::query()
            ->where('user_id', $request->user()?->getAuthIdentifier())
            ->first();

        if ($clinician === null) {
            throw new IllegalTransition(
                'This account is not a registered clinician of this clinic. A prescription '
                .'is a clinical act by a licensed clinician, issued in their own name.'
            );
        }

        return $clinician;
    }
}
