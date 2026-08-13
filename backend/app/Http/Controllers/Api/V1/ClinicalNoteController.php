<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Consultations\AddClinicalNoteAddendumRequest;
use App\Http\Requests\V1\Consultations\StoreClinicalNoteRequest;
use App\Http\Resources\V1\ClinicalNoteResource;
use App\Models\ClinicalNote;
use App\Models\Consultation;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

/**
 * Clinical notes within a consultation.
 *
 * There is no update and no delete, and their absence is the point. A note is
 * corrected by adding an addendum that supersedes it; the original stays
 * readable forever. A medical record that can be silently rewritten is not a
 * medical record, and no role -- clinician, administrator or Carevelo -- is
 * given a route around that.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md section 5
 * @see docs/20-domain/domain-model.md
 */
class ClinicalNoteController extends Controller
{
    public function __construct(private readonly AuditLog $audit) {}

    /**
     * Every note on the consultation, oldest first, superseded ones included.
     */
    public function index(Consultation $consultation): AnonymousResourceCollection
    {
        $this->authorize('view', $consultation);

        // Ordered by id after created_at: ULIDs sort lexicographically by
        // generation time, so two drafts saved inside the same second still
        // come back in the order the clinician wrote them.
        $notes = $consultation->notes()->orderBy('created_at')->orderBy('id')->get();

        $this->audit->record('clinical_note.viewed', 'consultation', $consultation->id, [
            'note_count' => $notes->count(),
        ]);

        return ClinicalNoteResource::collection($notes);
    }

    /**
     * Save a note, including a partial one.
     *
     * Drafts persist continuously as they are typed, so this endpoint accepts
     * an unfinished note and stores it immediately. A lost connection must
     * never lose clinical text -- it is the single most likely cause of a
     * clinician abandoning the product, and the text is often the only record
     * of what was said.
     *
     * Each save is a new row rather than an overwrite, because the model
     * forbids overwriting a body at all.
     */
    public function store(StoreClinicalNoteRequest $request, Consultation $consultation): JsonResponse
    {
        // Writing a clinical record is a clinical act. An administrator who may
        // read the encounter may not author within it.
        $this->authorize('conduct', $consultation);

        /** @var User $user */
        $user = $request->user();

        $note = DB::transaction(function () use ($request, $consultation, $user): ClinicalNote {
            $note = $consultation->notes()->create([
                'author_id' => $user->id,
                'body' => $request->string('body')->toString(),
                'note_type' => $request->string('note_type', 'subjective')->toString(),
            ]);

            // Identifiers and the section only. The body is health data and
            // never enters the audit log; the log records THAT a note was
            // written to WHICH consultation, never what it said.
            $this->audit->record('clinical_note.recorded', 'clinical_note', $note->id, [
                'consultation_id' => $consultation->id,
                'note_type' => $note->note_type,
            ]);

            return $note;
        });

        return ClinicalNoteResource::make($note)->response()->setStatusCode(201);
    }

    /**
     * Correct a note by adding an addendum.
     *
     * PATCH, but nothing is patched. The response is a NEW note of type
     * `addendum` carrying `supersedes_note_id`; the note named in the path is
     * untouched and still returned by index(). Attempting to change its body
     * instead throws.
     */
    public function addendum(
        AddClinicalNoteAddendumRequest $request,
        Consultation $consultation,
        ClinicalNote $note,
    ): JsonResponse {
        $this->authorize('conduct', $consultation);

        // 404 rather than 403 when the note belongs to a different encounter.
        // A 403 would confirm the note exists, and which encounter a note
        // belongs to is itself health information.
        if ($note->consultation_id !== $consultation->id) {
            abort(404);
        }

        /** @var User $user */
        $user = $request->user();

        $addendum = DB::transaction(function () use ($request, $consultation, $note, $user): ClinicalNote {
            $addendum = $note->addendum($request->string('body')->toString(), $user->id);

            $this->audit->record('clinical_note.addendum_recorded', 'clinical_note', $addendum->id, [
                'consultation_id' => $consultation->id,
                'supersedes_note_id' => $note->id,
            ]);

            return $addendum;
        });

        return ClinicalNoteResource::make($addendum)->response()->setStatusCode(201);
    }
}
