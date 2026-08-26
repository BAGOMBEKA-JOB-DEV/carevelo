<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\ConsultationMessageSent;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Consultations\StoreConsultationMessageRequest;
use App\Http\Resources\V1\ConsultationMessageResource;
use App\Models\Consultation;
use App\Models\ConsultationMessage;
use App\Models\ConsultationMessageAuthor;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

/**
 * Chat inside a consultation.
 *
 * WHY THIS EXISTS AT ALL. Two documents already promise it --
 * docs/50-security-compliance/threat-model.md and
 * docs/30-architecture/integrations.md both answer "video provider down" with
 * "falls back to chat, which we serve ourselves" -- and until this controller
 * existed that fallback was a notice and a telephone number. It matters more now
 * that the SFU is self-hosted: the outage those tables describe is one we
 * operate, so the thing we degrade to has to be one we operate too.
 *
 * THERE IS NO update AND NO delete, and their absence is the same design
 * decision ClinicalNoteController makes. A conversation is corrected by saying
 * something else, which is what people do anyway and which leaves the original
 * visible. What differs from the note is that there is no addendum endpoint
 * either: a note needs one because it is a composed document, while a message
 * already has the natural correction -- the next message.
 *
 * EVERY METHOD AUTHORISES `participate`, NOT `view` AND NOT `conduct`. conduct
 * is Clinician-only and would have left the patient unable to type; view is
 * clinic-wide and would have put the whole staff inside a two-person
 * conversation. The reasoning is written out on the ability itself.
 *
 * @see docs/30-architecture/realtime-and-video.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class ConsultationMessageController extends Controller
{
    public function __construct(private readonly AuditLog $audit) {}

    /**
     * The transcript, oldest first.
     *
     * Open after the encounter ends and forever afterwards, unlike store(). The
     * conversation is part of the medical record, and a record you cannot read
     * back is not one.
     */
    public function index(Consultation $consultation): AnonymousResourceCollection
    {
        $this->authorize('participate', $consultation);

        $messages = $consultation->messages()->get();

        // Reads of clinical records are audited as well as writes: "who read my
        // consultation?" can only be answered by having recorded every read. A
        // count, never a line.
        $this->audit->record('consultation_message.viewed', 'consultation', $consultation->id, [
            'message_count' => $messages->count(),
        ]);

        return ConsultationMessageResource::collection($messages);
    }

    /**
     * Say something.
     *
     * Works whether or not the video provider is configured, and that is the
     * requirement rather than a side effect: this endpoint touches
     * config('video') nowhere, mints no join token and asks no SFU anything, so
     * a clinic whose LiveKit deployment is unreachable still has a working
     * consultation channel. If chat depended on the media stack it would be
     * unavailable in precisely the outage it exists for.
     */
    public function store(StoreConsultationMessageRequest $request, Consultation $consultation): JsonResponse
    {
        $this->authorize('participate', $consultation);

        $this->assertStillInProgress($consultation);

        /** @var User $user */
        $user = $request->user();

        $message = DB::transaction(function () use ($request, $consultation, $user): ConsultationMessage {
            $message = $consultation->messages()->create([
                'author_id' => $user->id,
                'author_role' => $this->authorRole($user, $consultation),
                'body' => $request->string('body')->toString(),
            ]);

            /*
             * IDENTIFIERS AND THE SPEAKER. NEVER THE TEXT, AND NEVER ITS LENGTH.
             *
             * The audit log records THAT a message was sent to WHICH encounter
             * by WHICH side. It is the record that answers "who read or wrote in
             * my consultation", which is a question a subject access request or
             * a breach investigation actually asks, and it must be answerable
             * without the audit trail becoming a second copy of the clinical
             * record -- audit_events is exported, read by administrators, and
             * append-only for the application role, so anything written here is
             * written somewhere far less guarded than consultation_messages.
             *
             * Message length is deliberately absent too. It looks like metadata
             * and is derived from content: over a conversation, a sequence of
             * lengths against known prompts is a side channel, and it buys
             * nothing an investigation needs.
             */
            $this->audit->record('consultation_message.sent', 'consultation_message', $message->id, [
                'consultation_id' => $consultation->id,
                'author_role' => $message->author_role->value,
            ]);

            return $message;
        });

        // AFTER the commit, never inside it: a frame announcing a message that
        // then rolls back puts a line in one participant's screen that exists
        // nowhere in the record.
        event(ConsultationMessageSent::from($message));

        return ConsultationMessageResource::make($message)->response()->setStatusCode(201);
    }

    /**
     * Which side is speaking, decided here and never taken from the request.
     *
     * `participate` has already narrowed the set of possible senders to exactly
     * two people -- the patient the encounter belongs to, and the clinician
     * conducting it -- so establishing that this is not the patient is enough to
     * establish that it is the clinician. The patient test is the same
     * ownership check the policy used, so the stored role cannot disagree with
     * the decision that permitted the write.
     */
    private function authorRole(User $user, Consultation $consultation): ConsultationMessageAuthor
    {
        return $user->owns($consultation->patient_id)
            ? ConsultationMessageAuthor::Patient
            : ConsultationMessageAuthor::Clinician;
    }

    /**
     * Refuse to add to an encounter that has ended.
     *
     * A DELIBERATE DIVERGENCE FROM ClinicalNoteController, which accepts a note
     * after the consultation closes -- correctly, because clinicians write their
     * notes up afterwards and a note is addressed to the record.
     *
     * A message is addressed to a person. Accepting one after the encounter ends
     * turns this into asynchronous clinical messaging: a patient types a new
     * symptom into a closed consultation, sees it delivered, and reasonably
     * believes a clinician is reading it. Nobody is. That is a patient-safety
     * failure dressed as a feature, and it is also a different regulated
     * product from the one described in the PRD. If the clinic wants continuing
     * contact, the answer is a new appointment.
     *
     * 409 with a message written for the person who triggered it, so the client
     * can say what happened instead of showing a failed send.
     */
    private function assertStillInProgress(Consultation $consultation): void
    {
        if ($consultation->ended_at !== null) {
            throw new IllegalTransition(
                'This consultation has ended, so it accepts no further messages. '
                .'The conversation stays readable as part of the record; '
                .'continuing care needs a new appointment.'
            );
        }
    }
}
