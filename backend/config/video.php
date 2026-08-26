<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Consultation media transport
    |--------------------------------------------------------------------------
    |
    | LiveKit, on a server WE run. ADR-0004 chose Option A -- self-hosted -- and
    | the two things worth restating where the credentials live are the reason and
    | the price of the reason.
    |
    | THE PRICE IS THE DECISION. A Starter clinic pays UGX 150,000/month (~$40,
    | Business Plan SS-F) and teleconsult is listed as included. Two hundred
    | twenty-minute consultations is 8,000 participant-minutes: LiveKit Cloud at
    | ~$0.0005/min is about $4 of a $40 subscription, Daily at $0.004/min is $32,
    | Twilio at $0.015/min is $120 -- three times the subscription, on a plan that
    | has to also pay for everything else. Self-hosted, the marginal consultation
    | is ZERO, and the bill is a fixed VPS instead of a number that grows with
    | success. Reintroducing a per-minute provider is not a configuration change;
    | it is a change to whether the Starter tier makes money.
    |
    | AND SELF-HOSTING IS NOT FREE, WHICH IS THE HALF THAT GETS FORGOTTEN. It buys
    | a fixed cost and residency; it costs a media server and a TURN server to
    | operate, the bandwidth both consume, and a failing 9am call with nobody on
    | call. TURN in particular is mandatory rather than optional here: Ugandan
    | mobile carriers are behind carrier-grade NAT, so a large share of patients
    | cannot reach the SFU peer-to-peer at all. deploy/livekit/README.md says all
    | of that plainly, including what breaks when TURN is missing, because that
    | failure presents as "video just doesn't work for some patients" and is
    | almost undiagnosable after the fact.
    |
    | THE SWITCH WAS CHEAP BECAUSE THE SOFTWARE DID NOT CHANGE. LiveKit Cloud and
    | a self-hosted LiveKit are the same Apache-2.0 SFU, the same SDKs and the
    | same API. Pointing `url` at our own deployment and signing with our own key
    | is the entire difference, and it is also why the decision stays reversible
    | in the other direction if operating this proves to be the wrong use of
    | founder weeks.
    |
    | NOTHING HERE CONFIGURES RECORDING, and nothing may. Consultation recording
    | is a standing non-goal (docs/10-product/non-goals.md) and the ABSENCE of a
    | media store is load-bearing in ADR-0004's residency argument: there is no
    | store of consultation media to breach, only ephemeral streams. LiveKit
    | Egress is the feature that would create one, and it is deliberately absent
    | from this file, from the compose file in deploy/livekit, from the grant we
    | mint, and from the tests.
    |
    | @see docs/70-decisions/0004-video-provider-selection.md
    | @see docs/30-architecture/realtime-and-video.md
    | @see deploy/livekit/README.md
    |
    */

    'livekit' => [

        /*
         * The API key. Public-ish: it travels in the `iss` claim of every token
         * we mint and is readable by anyone holding one. It is an identifier for
         * the key pair, not a secret, and it is still not logged, because a log
         * line that carries the key is one careless edit away from carrying the
         * pair.
         *
         * No default. Unset means unconfigured, and unconfigured is a WORKING
         * state: AppServiceProvider binds UnconfiguredVideoProvider instead, and
         * a patient is shown the clinic's phone number rather than a dead room.
         */
        'api_key' => env('LIVEKIT_API_KEY'),

        /*
         * The API secret. WRITE-ONLY, exactly as the Pesapal consumer secret and
         * the TOTP secret are: never returned in a response, never logged, never
         * recorded on an audit event, and never placed in an exception message.
         *
         * It is the HMAC key over every join credential we mint, so anyone
         * holding it can mint a token for ANY room -- which, since a room name
         * is `apt-{ulid}` and appointment ulids appear in our own API responses,
         * means anyone holding it can enter a named patient's consultation. That
         * is the strongest reason on this page for the discipline, and a test
         * asserts it end to end over HTTP rather than by reading a class.
         *
         * NO DEFAULT, DELIBERATELY, AND THIS ONE IS NOT A STYLE CHOICE. The
         * obvious convenience -- defaulting to the well-known LiveKit dev secret
         * so video "just works" -- would mean a production deployment that forgot
         * one .env line signed real consultations with a value published in this
         * repository and in LiveKit's own documentation. Everything would appear
         * to work. Anyone at all could join any consultation. An unset secret
         * degrades visibly; a public one fails silently and catastrophically.
         *
         * The local development values live in .env.example, where they are
         * labelled as public, and they match deploy/livekit/livekit.yaml.
         */
        'api_secret' => env('LIVEKIT_API_SECRET'),

        /*
         * The signalling URL the BROWSER connects to, `wss://…` in production.
         *
         * This is our own server now, which removes the hazard the previous
         * version of this comment guarded against: with a managed provider a
         * project WAS an environment, and a stray default would have put a
         * staging deployment's consultations into the production project
         * alongside real patients. A URL naming a machine we run cannot do that.
         *
         * So a default is safe here, and it is the address deploy/livekit brings
         * up on a developer's own machine. Loopback: if it is ever wrong in
         * production nothing connects, which is loud, and it can never point
         * somewhere that belongs to somebody else.
         *
         * Handed to the browser in the redeem response, because the media leg is
         * browser <-> our SFU and never traverses the Laravel API.
         */
        'url' => env('LIVEKIT_URL', 'ws://127.0.0.1:7880'),

        /*
         * How long a minted media credential is valid, in seconds.
         *
         * Not the join token's lifetime. Those are two different credentials
         * with two different jobs: JoinToken::TTL_MINUTES (15) bounds how long a
         * participant has to walk through OUR door, and this bounds how long the
         * credential they are handed opens the SFU's. It has to outlive the
         * consultation itself -- a token that expires mid-encounter presents as
         * a call that cannot be rejoined after a tunnel or a dropped 3G
         * connection, which is precisely the network this product runs on.
         *
         * One hour: a twenty-minute consultation plus the thirty-minute overrun
         * JoinToken::GRACE_MINUTES already allows for, plus room to reconnect.
         * LiveKitAccessToken clamps whatever is configured here into a sane
         * range, so a stray 86400 in an .env cannot mint a day-long key to a
         * consultation room.
         */
        'token_ttl' => env('LIVEKIT_TOKEN_TTL_SECONDS', 3600),

    ],

];
