<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\JoinToken;
use App\Models\User;
use App\Support\Video\VideoProvider;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Brokering entry to a consultation.
 *
 * Two steps on purpose. Issuing hands a participant a short-lived secret;
 * redeeming spends it and returns the provider credentials. Collapsing them into
 * one call would mean "single-use" was a claim rather than a property — a browser
 * refresh would either break the consultation or quietly prove the token was
 * reusable — and the architecture requires that issuance AND use each write an
 * audit event, which needs two moments to record.
 *
 * The provider learns a room name and a role. Nothing else ever crosses that
 * boundary.
 *
 * @see docs/30-architecture/realtime-and-video.md
 */
class JoinTokenController extends Controller
{
    public function __construct(
        protected AuditLog $audit,
        protected VideoProvider $video,
    ) {}

    /**
     * Issue this participant a token for this appointment.
     */
    public function issue(Request $request, Appointment $appointment): JsonResponse
    {
        $this->authorize('join', $appointment);

        $user = $request->user();

        if (! $user instanceof User) {
            throw new AuthorizationException;
        }

        $this->assertJoinable($appointment);

        [$token, $plaintext] = JoinToken::issueFor($appointment, $user);

        // The audit event records THAT a token was issued and to which role. Not
        // the token, and not who the patient is beyond the identifier the trail
        // already carries.
        $this->audit->record('consultation.join_token_issued', 'Appointment', $appointment->id, [
            'participant' => $this->labelFor($user, $appointment),
            'expires_at' => $token->expires_at->toIso8601String(),
        ]);

        return new JsonResponse([
            'data' => [
                // The only moment the plaintext exists. It is not stored, and it
                // cannot be re-read from this endpoint.
                'token' => $plaintext,
                'expires_at' => $token->expires_at->toIso8601String(),
            ],
        ], 201);
    }

    /**
     * Spend a token and return the credentials to enter the room.
     *
     * The token arrives in the BODY, never in the path. A secret in a URL is
     * written to the web server's access log, kept in the browser's history, and
     * handed to whatever the page links to next in the Referer header. None of
     * those are places a credential that opens a consultation may sit.
     */
    public function redeem(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'max:255'],
        ]);

        $token = (string) $validated['token'];

        $user = $request->user();

        if (! $user instanceof User) {
            throw new AuthorizationException;
        }

        // Inside a transaction, and re-read FOR UPDATE, because two tabs
        // redeeming at once would otherwise both find the token unspent and both
        // be admitted -- which is precisely the reusability the token exists to
        // prevent.
        $record = DB::transaction(function () use ($token, $user): JoinToken {
            $candidates = JoinToken::query()
                ->where('user_id', $user->id)
                ->whereNull('consumed_at')
                ->lockForUpdate()
                ->get();

            // Hash comparison, so the lookup cannot be done by SQL. The candidate
            // set is this participant's own live tokens, which is a handful.
            $match = $candidates->first(fn (JoinToken $candidate) => $candidate->matches($token));

            if (! $match instanceof JoinToken || ! $match->isLive()) {
                // Same refusal for a wrong token, an expired one, a spent one and
                // one belonging to somebody else. Distinguishing them tells a
                // caller which of those it holds.
                throw new AuthorizationException('This join link is not valid. Please request a new one.');
            }

            $match->consume();

            return $match;
        });

        $appointment = $record->appointment;

        if (! $appointment instanceof Appointment) {
            throw new AuthorizationException('This join link is not valid. Please request a new one.');
        }

        $this->audit->record('consultation.join_token_redeemed', 'Appointment', $appointment->id, [
            'participant' => $this->labelFor($user, $appointment),
            'provider' => $this->video->name(),
        ]);

        return new JsonResponse([
            'data' => $this->video->credentialsFor(
                $record->room_name,
                $this->labelFor($user, $appointment),
            ),
        ]);
    }

    /**
     * A consultation can only be entered around the time it is due.
     *
     * Confirmed or already under way. Not an unpaid booking, not one cancelled an
     * hour ago, and not one from last March — a token that outlives its
     * appointment is a standing invitation.
     *
     * @throws AuthorizationException
     */
    private function assertJoinable(Appointment $appointment): void
    {
        $joinable = in_array($appointment->status, [
            AppointmentStatus::Confirmed,
            AppointmentStatus::InProgress,
        ], true);

        if (! $joinable) {
            throw new AuthorizationException('This appointment cannot be joined.');
        }

        $endsAt = $appointment->scheduled_end_at;

        if ($endsAt !== null && $endsAt->addMinutes(JoinToken::GRACE_MINUTES)->isPast()) {
            throw new AuthorizationException('This appointment has finished.');
        }
    }

    /**
     * The participant's ROLE, never their identity.
     *
     * This is the one string besides the room name that reaches the provider, so
     * it says 'patient' or 'clinician' and stops there.
     */
    private function labelFor(User $user, Appointment $appointment): string
    {
        return $user->owns((string) $appointment->patient_id) ? 'patient' : 'clinician';
    }
}
