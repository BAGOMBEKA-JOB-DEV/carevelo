<?php

namespace App\Support\Video;

/**
 * The boundary behind which a consultation media provider sits.
 *
 * ADR-0004 is now Accepted: LiveKit, self-hosted, chosen on cost. This interface
 * is what that ADR relied on when it called the decision reversible — "the
 * interface boundary keeps the decision reversible, which is what makes starting
 * with the pragmatic option defensible rather than merely convenient" — and it
 * paid out. Choosing a provider was one binding in AppServiceProvider. Nothing
 * above this line learned which one, and nothing above it should.
 *
 * The ADR's remaining blocker is a field measurement, not a code change: East
 * African mobile network performance is still untested before the first
 * production consultation, and self-hosting makes that MORE important rather than
 * less, because the tuning is now ours to get wrong.
 *
 * THE PROVIDER IS TOLD A ROOM NAME AND A PARTICIPANT LABEL. Nothing else. No
 * patient name, no phone number, no clinician identity, no reason for the
 * consultation, no clinic.
 *
 * That rule was written when the provider was going to be a third party outside
 * Uganda and every field was a cross-border transfer to disclose under the DPPA.
 * Self-hosting removes the transfer, and DOES NOT REMOVE THE RULE. Two reasons
 * survive the move. A participant identity is broadcast to everyone else in the
 * room, so it is not a private field between us and a server. And the media
 * server's logs are operational — outside the tenant database, outside RLS, read
 * by whoever is debugging at the time — so a name or a service placed here is
 * clinical context sitting in a plain text file on a VPS.
 *
 * Media never traverses the Laravel API either: the browser talks to the media
 * server directly, and nothing is recorded.
 *
 * @see docs/30-architecture/realtime-and-video.md
 * @see docs/70-decisions/0004-video-provider-selection.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
interface VideoProvider
{
    /**
     * Credentials for one participant to enter one room.
     *
     * @param  string  $room  Opaque identifier, `apt-{ulid}`. Never a name.
     * @param  string  $participantLabel  'patient' or 'clinician' — a ROLE, never
     *                                    a person. Enough for the far end to lay
     *                                    out two tiles, and no more.
     * @return array<string, string>
     */
    public function credentialsFor(string $room, string $participantLabel): array;

    /**
     * The provider this implementation speaks to, for diagnostics and audit.
     *
     * Recorded on the audit event, which is why it survived the provider actually
     * being chosen: the trail now distinguishes consultations brokered before a
     * provider existed ('unconfigured') from those brokered over LiveKit, and
     * would distinguish a third again if this ever moved.
     */
    public function name(): string;
}
