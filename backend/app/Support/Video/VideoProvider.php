<?php

namespace App\Support\Video;

/**
 * The boundary behind which a consultation media provider sits.
 *
 * ADR-0004 is still *Proposed*: no provider is selected, and the East African
 * network testing it makes a condition has not been done. This interface is what
 * that ADR relies on when it calls the decision reversible — "the interface
 * boundary keeps the decision reversible, which is what makes starting with the
 * pragmatic option defensible rather than merely convenient."
 *
 * So the shape is settled now and the choice later, and nothing above this line
 * learns which provider was picked.
 *
 * THE PROVIDER IS TOLD A ROOM NAME AND A PARTICIPANT LABEL. Nothing else. No
 * patient name, no phone number, no clinician identity, no reason for the
 * consultation, no clinic. It is a third party, in Phase 1 very likely outside
 * Uganda, and every field handed to it is a cross-border transfer of personal
 * data that would have to be disclosed in the consent text under the DPPA. The
 * cheapest way to keep that disclosure honest is to transfer nothing.
 *
 * Media never traverses the Laravel API either: the browser talks to the provider
 * directly, and nothing is recorded.
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
     * Recorded on the audit event so that when a provider is finally chosen, the
     * trail distinguishes consultations brokered before and after.
     */
    public function name(): string;
}
