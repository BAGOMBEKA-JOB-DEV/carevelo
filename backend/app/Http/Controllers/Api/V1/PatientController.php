<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Patients\MergePatientRequest;
use App\Http\Requests\V1\Patients\StorePatientRequest;
use App\Http\Requests\V1\Patients\UpdatePatientRequest;
use App\Http\Resources\V1\PatientResource;
use App\Models\Patient;
use App\Models\PatientStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Registration. Where DPPA 2019 compliance either happens or fails.
 *
 * The controller does no tenant filtering. Row-level security is bound to the
 * database session before the router dispatches, so another clinic's patients
 * are not hidden here -- they are not there at all.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 */
class PatientController extends Controller
{
    /**
     * Every table that names a patient, and so every table a merge must move.
     *
     * A new patient-owning table added without appearing here would leave history
     * stranded on the duplicate, which is why MergesEveryPatientRelationTest
     * derives this same list from the schema and fails if the two disagree.
     *
     * @var list<string>
     */
    private const MERGED_RELATIONS = [
        'consent_records',
        'appointments',
        'consultations',
        'prescriptions',
        'dispense_orders',
    ];

    public function __construct(protected AuditLog $audit) {}

    /**
     * The clinic's patient list.
     *
     * Cursor pagination, not offset: front desk pages through this while walk-in
     * registrations are being created beside them, and offsets duplicate and
     * skip rows under exactly that traffic.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Patient::class);

        // Allow-listed. Never build a query from arbitrary client input.
        $filters = $request->validate([
            'status' => ['sometimes', Rule::enum(PatientStatus::class)],
        ]);

        $status = $filters['status'] ?? null;

        $patients = Patient::query()
            // A merged duplicate holds no history any more. Listing it invites
            // staff to open the empty half of a person.
            ->notMerged()
            ->when(
                is_string($status),
                fn (Builder $query) => $query->where('status', $status),
            )
            ->orderBy('family_name')
            ->orderBy('given_name')
            ->orderBy('id')
            ->cursorPaginate(25);

        return PatientResource::collection($patients);
    }

    /**
     * Register a patient, in `pending_consent`.
     *
     * NO clinical data may attach in that state, which is why the status is set
     * here and cannot be supplied: a client able to post `active` could register
     * a patient who never consented to anything.
     *
     * The response is deliberately indistinguishable whether or not the number
     * was already on file. "This phone is already registered" confirms that a
     * specific person is a patient of this specific clinic, and the fact of
     * being someone's patient is itself special-category information under DPPA
     * 2019. So a repeat registration returns the record that already exists,
     * with the same status code and the same shape, and creates nothing.
     */
    public function store(StorePatientRequest $request): JsonResponse
    {
        $this->authorize('create', Patient::class);

        $attributes = $request->validated();
        $phone = $attributes['phone'];

        $patient = Patient::query()->where('phone', $phone)->first();

        if ($patient === null) {
            try {
                $patient = Patient::create([
                    ...$attributes,
                    'status' => PatientStatus::PendingConsent,
                ]);

                $this->audit->record(
                    'patient.registered',
                    subjectType: 'Patient',
                    subjectId: $patient->id,
                    metadata: ['status' => $patient->status->value],
                );
            } catch (UniqueConstraintViolationException) {
                // Two registrations for the same number, racing. The unique
                // index settles it; the loser reads the winner's row rather
                // than surfacing a 500 that would itself disclose the clash.
                $patient = Patient::query()->where('phone', $phone)->firstOrFail();
            }
        }

        return (new PatientResource($patient))->response()->setStatusCode(201);
    }

    public function show(Patient $patient): PatientResource
    {
        $this->authorize('view', $patient);

        $this->audit->record(
            'patient.viewed',
            subjectType: 'Patient',
            subjectId: $patient->id,
        );

        return new PatientResource($patient);
    }

    /**
     * Correct a patient's details.
     *
     * `status` is not writable here by design. States move through consent
     * decisions, not through a field assignment.
     */
    public function update(UpdatePatientRequest $request, Patient $patient): PatientResource
    {
        $this->authorize('update', $patient);

        if ($patient->status === PatientStatus::Discarded) {
            // Discarded is final. The record exists only to explain why service
            // could not proceed, and is purged on schedule.
            throw new IllegalTransition(
                'This registration ended when consent was declined and can no longer be changed.'
            );
        }

        $changes = $request->validated();

        try {
            $patient->fill($changes)->save();
        } catch (UniqueConstraintViolationException) {
            // Neutral: it does not confirm that the number belongs to an
            // existing patient here, only that this record cannot take it.
            throw ValidationException::withMessages([
                'phone' => 'This number cannot be used on this record. Check it, or merge the duplicate registration.',
            ]);
        }

        $this->audit->record(
            'patient.updated',
            subjectType: 'Patient',
            subjectId: $patient->id,
            // Which fields changed, never what they changed to.
            metadata: ['fields' => array_keys($changes)],
        );

        return new PatientResource($patient);
    }

    /**
     * Fold a duplicate registration into this record.
     *
     * Within a tenant only, and that is not enforced here: row-level security is
     * bound before dispatch, so a patient identifier from another clinic does not
     * resolve at all. There is no cross-tenant patient identity to merge onto and
     * adding one would breach the isolation boundary.
     *
     * The duplicate SURVIVES, pointing at the winner. Nobody deletes a patient --
     * the clinic may be obliged to retain the medical record, and a row that once
     * carried a consent decision has to stay explicable.
     *
     * What deliberately does NOT happen: the survivor's status is not recomputed
     * from the consent records it inherits. If the duplicate was `active` and the
     * survivor is `pending_consent`, the survivor stays `pending_consent` and the
     * front desk confirms consent through the consent surface. Silently promoting
     * a record to `active` because a different registration once consented is the
     * one failure mode here that ends with clinical data attached to a patient who
     * never agreed to any of it.
     */
    public function merge(MergePatientRequest $request, Patient $patient): PatientResource
    {
        $this->authorize('merge', $patient);

        $duplicate = Patient::query()->findOrFail($request->duplicatePatientId());

        if ($patient->isMerged()) {
            throw new IllegalTransition(
                'This record was itself merged into another. Merge into the record that survived.'
            );
        }

        if ($duplicate->isMerged()) {
            throw new IllegalTransition('That duplicate has already been merged.');
        }

        $moved = DB::transaction(function () use ($patient, $duplicate): array {
            // Every table that names a patient. Repointing rather than copying:
            // a consultation belongs to one patient record, and duplicating it
            // would double the medical history rather than unify it.
            $moved = [];

            foreach (self::MERGED_RELATIONS as $table) {
                $moved[$table] = DB::table($table)
                    ->where('patient_id', $duplicate->id)
                    ->update(['patient_id' => $patient->id]);
            }

            $duplicate->merged_into_patient_id = $patient->id;
            $duplicate->save();

            return $moved;
        });

        $this->audit->record(
            'patient.merged',
            subjectType: 'Patient',
            subjectId: $patient->id,
            // Identifiers and row counts. How many consultations moved is an
            // outcome; what any of them said is not this record's business.
            metadata: [
                'merged_patient_id' => $duplicate->id,
                'records_moved' => $moved,
            ],
        );

        return new PatientResource($patient->refresh());
    }
}
