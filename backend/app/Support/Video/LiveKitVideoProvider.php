<?php

namespace App\Support\Video;

use InvalidArgumentException;

/**
 * Consultation media over a LiveKit SFU that WE run.
 *
 * ============================================================
 * WHAT THIS CLASS ACTUALLY DOES, WHICH IS ALMOST NOTHING
 * ============================================================
 *
 * It mints one JWT and hands back a URL. There is no HTTP call to a provider
 * here, no room to create, no SDK to keep in step with -- LiveKit creates a room
 * on the first participant to arrive holding a token that names it, and destroys
 * it when the last one leaves. That is the whole integration.
 *
 * It reads as suspiciously small for "the video provider", so it is worth saying
 * where the work went instead: the token minting is in LiveKitAccessToken (read
 * its docblock -- the grant is the privacy boundary), the authorisation and
 * single-use accounting are in JoinTokenController and JoinToken, and the media
 * infrastructure is a docker-compose and a TURN server in deploy/livekit. This
 * class is the seam between those three and nothing more.
 *
 * ============================================================
 * SELF-HOSTED, AND WHY THAT CHANGED WHAT THIS FILE SAYS
 * ============================================================
 *
 * ADR-0004 chose Option A -- a LiveKit we operate -- on cost. A Starter clinic
 * pays UGX 150,000/month (~$40) with teleconsult included; two hundred
 * twenty-minute consultations is 8,000 participant-minutes, which is $4 a month
 * on LiveKit Cloud, $32 on Daily and $120 on Twilio. Self-hosted, the marginal
 * consultation costs nothing at all, and the bill is a fixed monthly VPS instead.
 *
 * That is NOT the same as free, and the surrounding comments were rewritten
 * rather than left alone because the old ones assumed a managed provider. What we
 * now own: a media server, a TURN server, the bandwidth both consume, and every
 * failing 9am call with no operations engineer to escalate to. deploy/livekit/
 * README.md is where that is written down honestly.
 *
 * What it buys, beyond the money: media never leaves the region we chose, so the
 * DPPA-2019 residency position is the strong version rather than the hedged one,
 * and there is no cross-border transfer left to disclose in the H2 consent text.
 *
 * THE INTERFACE DID NOT WIDEN, AND MUST NOT. Self-hosting makes the disclosure
 * argument moot, but not the discipline behind it: this class is handed an opaque
 * `apt-{ulid}` and the string 'patient' or 'clinician', and a participant
 * identity is visible to everyone else in the room and written into the media
 * server's own logs. A patient's name here would be a patient's name on a server
 * whose logs are operational, not clinical, and not covered by RLS.
 *
 * @see docs/70-decisions/0004-video-provider-selection.md
 * @see deploy/livekit/README.md
 */
final class LiveKitVideoProvider implements VideoProvider
{
    /**
     * The only two identities that may ever be minted into a token.
     *
     * A belt over the braces in JoinTokenController::labelFor(), which already
     * returns exactly these. The duplication is deliberate: labelFor() is a
     * private method one refactor away from growing "…and if it is a supervising
     * clinician, say so", and the cost of that landing is a person's role -- or,
     * one step further along the same slope, their name -- travelling into a
     * token that the other participant's browser can decode and the media
     * server's logs retain.
     *
     * It throws rather than falling back to 'patient', because a silent
     * substitution would mislabel a clinician's tile and nobody would ever see
     * why. An exception here means somebody widened the call site without reading
     * this file, which is precisely the moment to be loud.
     *
     * @var list<string>
     */
    public const PARTICIPANT_LABELS = ['patient', 'clinician'];

    public function __construct(
        private readonly string $url,
        private readonly LiveKitAccessToken $tokens,
    ) {}

    /**
     * @return array<string, string>
     */
    public function credentialsFor(string $room, string $participantLabel): array
    {
        if (! in_array($participantLabel, self::PARTICIPANT_LABELS, true)) {
            // The label, not the room and not the caller: the room name is an
            // appointment identifier, and an exception message ends up in a log
            // and possibly in an error report. The offending label is what a
            // reader needs to find the widened call site.
            throw new InvalidArgumentException(
                'A consultation participant is a role, not a person. Got: '.$participantLabel
            );
        }

        return [
            'room' => $room,
            'participant' => $participantLabel,
            'provider' => $this->name(),

            /*
             * THE STRING 'true', NOT THE BOOLEAN.
             *
             * VideoProvider::credentialsFor() is declared array<string, string>
             * and UnconfiguredVideoProvider returns the string 'false' for the
             * same key, so both frontends coerce with `=== 'true'` -- which they
             * must, because Boolean('false') is true and a client that trusted
             * the truthiness of this field would open a dead room for every
             * patient of a clinic whose credentials are missing.
             *
             * Returning a real boolean from this one implementation would make
             * the honest branch the broken one, silently, and only in production
             * where credentials exist. Keep the contract.
             */
            'configured' => 'true',

            /*
             * Where the browser connects. The media leg is browser <-> our SFU
             * and never traverses the Laravel API, so this is the one moment the
             * address is handed out.
             */
            'url' => $this->url,

            /*
             * Minted per participant per redemption, and never stored. The join
             * token this was exchanged for is single-use, so a refresh gets a new
             * one of these through a new redemption or nothing at all.
             */
            'token' => $this->tokens->mint($room, $participantLabel),
        ];
    }

    public function name(): string
    {
        return 'livekit';
    }
}
