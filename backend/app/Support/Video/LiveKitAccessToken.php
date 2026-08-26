<?php

namespace App\Support\Video;

use Illuminate\Support\Facades\Date;

/**
 * A LiveKit access token, which is a JWT, in about thirty lines over hash_hmac.
 *
 * ============================================================
 * WHY THIS IS HAND-WRITTEN, AND WHAT SHOULD REPLACE IT
 * ============================================================
 *
 * Nothing may be added to composer.lock in the change that introduced this file,
 * so `firebase/php-jwt` -- and `agence104/livekit-server-sdk`, which wraps it and
 * builds exactly this grant -- were not options. The same constraint produced
 * App\Support\Totp, and the same reasoning applies: the thing being written out
 * is small, completely specified, and has no room in it for a clever variation.
 *
 * A LiveKit access token is a JOSE-compact JWT with three parts joined by dots:
 * base64url(header) . base64url(claims) . base64url(HMAC-SHA256 over the first
 * two, keyed by the API secret). We only ever MINT one. We never verify one --
 * LiveKit does that, with the other half of the key pair -- so there is no
 * signature-verification path here to get wrong, which is the half of a JWT
 * library where the historic CVEs live (`alg: none`, HS256-vs-RS256 confusion,
 * unbounded `kid`). This class cannot exhibit any of them because it cannot read
 * a token at all.
 *
 * If a dependency can be added later, `firebase/php-jwt` is the better answer and
 * this class becomes a thin call into it. What must NOT happen is a second
 * hand-rolled JWT appearing beside it.
 *
 * ============================================================
 * THE GRANT IS THE PRIVACY BOUNDARY, SO IT IS WRITTEN OUT IN FULL
 * ============================================================
 *
 * This was written when the plan was LiveKit Cloud, where every claim below
 * crossed a border and each field was a DPPA-2019 transfer to disclose in the
 * consent text. ADR-0004 now says self-hosted, so the border is gone -- AND THE
 * RULE IS UNCHANGED, because two of the three reasons for it never depended on
 * the server belonging to somebody else.
 *
 * `sub` IS BROADCAST. LiveKit publishes a participant's identity to every other
 * participant in the room; it is not a private field between us and a server, it
 * is a value the other end's browser decodes. And the media server's LOGS are
 * operational -- outside the tenant database, outside RLS, read by whoever is
 * debugging a call at the time, and on a VPS rather than in the clinical estate.
 *
 * So: no `name` claim. LiveKit's own SDKs offer one and every example sets it,
 * because in an ordinary product the display name under a video tile is the
 * point. Here it would be a patient's name, in a log file on a media server, for
 * as long as that log is kept. `sub` carries the string 'patient' or 'clinician'
 * and that is the whole identity LiveKit is ever given. No `metadata` and no
 * `attributes` either, for the same reason and with less excuse -- they are
 * free-form, so they are where a future "just add the service name so the tile
 * says what the visit is for" would land.
 *
 * ============================================================
 * AND NO RECORDING GRANT, EVER
 * ============================================================
 *
 * `roomRecord` is stated as false rather than merely omitted. Consultation
 * recording is a standing non-goal, and ADR-0004's residency argument rests on
 * there being no media store to breach. LiveKit Egress is the feature that would
 * create one, `roomRecord` is the grant that would authorise it, and writing the
 * false out means a reader who wants recording has to delete a line with a
 * comment on it rather than add one nobody notices.
 *
 * Self-hosting makes this MORE tempting, not less -- Egress is included in the
 * same Apache-2.0 distribution we already run, so it costs nothing to switch on
 * and would produce a store of consultation video on a server we operate. The
 * compose file in deploy/livekit does not start it, and this grant does not
 * authorise it. Both of those are the answer, and both must stay the answer.
 *
 * @see docs/70-decisions/0004-video-provider-selection.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
final class LiveKitAccessToken
{
    /** JOSE's name for the algorithm; `sha256` is PHP's name for the same thing. */
    public const ALGORITHM = 'HS256';

    private const HASH = 'sha256';

    /** One hour. See config/video.php for why a consultation needs about that. */
    public const DEFAULT_TTL_SECONDS = 3600;

    /**
     * The ceiling, and the reason this class clamps rather than trusts.
     *
     * A media credential is a key to a room where two people discuss a patient's
     * health. Its lifetime is therefore a security property, and a security
     * property read from an .env file is one typo away from being wrong in the
     * direction nobody notices -- 86400 instead of 8640 mints a token that opens
     * a consultation room until this time tomorrow, and everything keeps working,
     * which is exactly why it would survive review.
     *
     * Two hours: generous enough for the longest consultation this product plans
     * for plus reconnections, and short enough that a token copied out of a
     * browser's storage is worthless by the afternoon.
     */
    public const MAX_TTL_SECONDS = 7200;

    /**
     * The floor. A token shorter than this cannot survive the round trip it is
     * minted for -- issue, redeem, hand to the browser, connect -- so a
     * configured 5 would present as "the room never opens" with nothing in any
     * log to say why.
     */
    public const MIN_TTL_SECONDS = 60;

    /**
     * How far back `nbf` is set.
     *
     * OUR clock and LIVEKIT'S clock are not the same clock. If ours runs a few
     * seconds fast, a token whose `nbf` is exactly now is not yet valid when it
     * arrives, and LiveKit refuses it -- a consultation that fails to open for
     * one minute and then starts working, which is close to undiagnosable from
     * either end. Backdating costs a minute of validity at the front of a token
     * that already has an hour, and removes the failure entirely. It is only ever
     * safe in this direction: an `nbf` in the past is accepted by everyone.
     */
    private const CLOCK_LEEWAY_SECONDS = 60;

    private readonly int $ttlSeconds;

    public function __construct(
        private readonly string $apiKey,
        private readonly string $apiSecret,
        int $ttlSeconds = self::DEFAULT_TTL_SECONDS,
    ) {
        $this->ttlSeconds = max(self::MIN_TTL_SECONDS, min(self::MAX_TTL_SECONDS, $ttlSeconds));
    }

    /** The lifetime actually in force, after clamping. */
    public function ttlSeconds(): int
    {
        return $this->ttlSeconds;
    }

    /**
     * Mint one participant's credential for one room.
     *
     * @param  string  $room  the opaque `apt-{ulid}`, checked by the caller
     * @param  string  $identity  'patient' or 'clinician', checked by the caller
     */
    public function mint(string $room, string $identity): string
    {
        $now = Date::now()->getTimestamp();

        $header = [
            'alg' => self::ALGORITHM,
            'typ' => 'JWT',
        ];

        $claims = [
            // The key pair this token was signed with. LiveKit looks the secret
            // up by it; it is an identifier, not a credential.
            'iss' => $this->apiKey,

            // THE PARTICIPANT'S ENTIRE IDENTITY, as far as LiveKit is
            // concerned, and it is broadcast to the other participant. A role.
            // Read the class docblock before widening this.
            'sub' => $identity,

            'nbf' => $now - self::CLOCK_LEEWAY_SECONDS,
            'exp' => $now + $this->ttlSeconds,

            'video' => [
                // Scoped to ONE room. A grant without this is a grant to every
                // consultation on the project.
                'room' => $room,
                'roomJoin' => true,

                // Both participants are equals in a consultation: each speaks and
                // each hears. There is no observer role and no third seat.
                'canPublish' => true,
                'canSubscribe' => true,

                /*
                 * NO DATA CHANNEL, and this is not an oversight.
                 *
                 * In-consultation chat is CLINICAL DATA. Realtime & Video is
                 * explicit that chat messages "are clinical data, stored
                 * in-tenant, subject to RLS, and never sent by SMS" -- so chat
                 * travels our own Reverb connection and lands in our own
                 * database under our own row-level security. Granting
                 * `canPublishData` would offer a second path for the same text:
                 * one that crosses the border to a third party AND leaves no
                 * record in the patient's file. It would look like a free
                 * feature and it is the one place in this grant where clinical
                 * content could leak.
                 */
                'canPublishData' => false,

                // Free-form and participant-controlled, which is why it is off:
                // it is a channel by which a client could put anything at all
                // into LiveKit's view of a participant.
                'canUpdateOwnMetadata' => false,

                // NEVER. See the class docblock, ADR-0004 and non-goals.md.
                'roomRecord' => false,

                // Nothing here administers anything. A participant credential
                // that could evict the other party, or read the room list for
                // the whole project, is an admin credential handed to a browser.
                'roomAdmin' => false,
                'roomList' => false,
            ],
        ];

        $signingInput = self::segment($header).'.'.self::segment($claims);

        return $signingInput.'.'.self::base64Url(
            hash_hmac(self::HASH, $signingInput, $this->apiSecret, true)
        );
    }

    /**
     * One JOSE segment: JSON, then base64url.
     *
     * JSON_UNESCAPED_SLASHES because the default escapes `/` as `\/`, which is
     * legal JSON, is not what any other JWT implementation emits, and makes a
     * token that has to be compared by eye against a reference implementation
     * needlessly hard to read. JSON_THROW_ON_ERROR because the alternative is
     * json_encode returning `false`, which would concatenate as an empty string
     * and produce a syntactically valid token with an empty header.
     *
     * @param  array<string, mixed>  $value
     */
    private static function segment(array $value): string
    {
        return self::base64Url(json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    /**
     * RFC 4648 §5 base64url: `+/` become `-_`, and the `=` padding goes.
     *
     * Unpadded is not a preference. A JWT is carried in headers and query strings
     * where `=` is a delimiter, so the compact serialisation forbids the padding
     * outright -- a padded segment is rejected by conforming verifiers, which
     * here means LiveKit refusing every token we mint.
     */
    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
