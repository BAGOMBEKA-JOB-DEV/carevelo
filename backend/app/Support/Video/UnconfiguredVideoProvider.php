<?php

namespace App\Support\Video;

/**
 * What answers when no media server is configured.
 *
 * It was written as the placeholder until ADR-0004 chose a provider. That ADR has
 * now chosen one — LiveKit, self-hosted — and THIS CLASS STAYS, because the
 * sentence it was carrying turned out to be permanent: "the same field will be
 * the honest answer if provider credentials are ever missing in production".
 * Deleting it the day LiveKit went live would trade a working fallback for a 500,
 * and the deployments where it fires are the ones that need it most — a
 * developer's machine with no SFU running, CI, a staging box, and the production
 * evening when a rotated secret does not make it into the environment.
 *
 * It brokers nothing. It returns the room name and the participant's role, which
 * is genuinely everything Carevelo knows and everything a media server is ever
 * told — so the token flow, its authorisation, its single-use accounting and its
 * audit trail are all exercised for real, and only the media leg is absent.
 *
 * Deliberately NOT a throwing stub. A join-token endpoint that raises when video
 * is unavailable cannot be tested, cannot be built against by the frontend, and
 * hands a patient a stack trace instead of the clinic's phone number.
 *
 * `configured` is false in the response so a client can say "video is not
 * available" and offer the phone number, rather than opening a dead room. That is
 * the same degradation the payments module makes for an unconfigured aggregator:
 * say so, and fall back rather than fail.
 *
 * @see docs/70-decisions/0004-video-provider-selection.md
 */
class UnconfiguredVideoProvider implements VideoProvider
{
    /**
     * @return array<string, string>
     */
    public function credentialsFor(string $room, string $participantLabel): array
    {
        return [
            'room' => $room,
            'participant' => $participantLabel,
            'provider' => $this->name(),

            /*
             * THE STRING 'false', NOT THE BOOLEAN, and this is load-bearing.
             *
             * VideoProvider::credentialsFor() is declared array<string, string>,
             * so the field has to be a string; both frontends therefore coerce
             * with `=== 'true'` rather than trusting truthiness, because
             * Boolean('false') is true and a client that got that wrong would
             * open a dead room for every patient this class answers for.
             *
             * LiveKitVideoProvider returns the string 'true' for the same reason.
             * Changing either one to a real boolean breaks the other end
             * silently, in one environment only.
             */
            'configured' => 'false',
        ];
    }

    public function name(): string
    {
        return 'unconfigured';
    }
}
