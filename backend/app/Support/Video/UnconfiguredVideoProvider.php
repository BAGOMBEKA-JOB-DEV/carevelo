<?php

namespace App\Support\Video;

/**
 * The provider in use until ADR-0004 chooses one.
 *
 * It brokers nothing. It returns the room name and the participant's role, which
 * is genuinely everything Carevelo knows and everything a provider would be told
 * — so the token flow, its authorisation, its single-use accounting and its audit
 * trail are all exercised for real, and only the media leg is absent.
 *
 * Deliberately NOT a throwing stub. A join-token endpoint that raises until a
 * commercial decision is made cannot be tested, cannot be built against by the
 * frontend, and would arrive at integration day never having run.
 *
 * `configured` is false in the response so a client can say "video is not
 * available yet" rather than opening a dead room. The same field will be the
 * honest answer if a clinic's provider credentials are ever missing in
 * production, which is the same degradation the payments module already makes for
 * an unconfigured aggregator: say so, and fall back rather than fail.
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
            'configured' => 'false',
        ];
    }

    public function name(): string
    {
        return 'unconfigured';
    }
}
