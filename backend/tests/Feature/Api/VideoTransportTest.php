<?php

use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\Patient;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Video\LiveKitAccessToken;
use App\Support\Video\LiveKitVideoProvider;
use App\Support\Video\UnconfiguredVideoProvider;
use App\Support\Video\VideoProvider;
use App\Tenancy\Tenancy;
use Database\Seeders\RoleSeeder;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| Consultation media transport -- LiveKit, self-hosted
|--------------------------------------------------------------------------
|
| ADR-0004 chose Option A: a LiveKit SFU we run ourselves, on cost. That decision
| moved the media server inside our own perimeter, and these tests are about the
| rules that did NOT move with it.
|
| The rule people expect to have been relaxed is the narrow one: the media server
| is told a room name and a role, and nothing else. It was originally narrow
| because LiveKit Cloud was a third party outside Uganda and every field was a
| DPPA-2019 cross-border transfer to disclose in the consent text. Self-hosting
| deletes the transfer. It does NOT delete the rule, for two reasons that never
| depended on who owned the server: a participant identity is broadcast to
| everyone else in the room, and the media server's logs are operational files on
| a VPS -- outside the tenant database, outside RLS, and read by whoever is
| debugging a call that morning.
|
| So each test below is a RULE, not a code path:
|
|   1. A minted token names a room and a role. Not a patient, not a service.
|   2. The API secret reaches no response body, no log line and no audit event.
|      It is the HMAC key over every credential we mint, so anyone holding it can
|      enter any named patient's consultation.
|   3. With no credentials the container resolves the unconfigured provider, and
|      that path keeps WORKING. A patient sees the clinic's phone number.
|   4. A minted token verifies against our secret and only against our secret.
|   5. A media credential's lifetime is bounded whatever an .env file says.
|
| @see docs/70-decisions/0004-video-provider-selection.md
| @see deploy/livekit/README.md
|
*/

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

/**
 * A service name no reasonable reader could mistake for coincidence.
 *
 * Deliberately unmistakable, and deliberately the most sensitive category this
 * product will ever carry. If this string ever appears inside a media credential,
 * the assertion failure needs to read as an incident rather than as a test being
 * fussy about field names -- so it is not 'General Consultation', which could
 * plausibly show up by accident and would be shrugged at.
 */
function videoUnmistakableService(): string
{
    return 'HIV Post-Exposure Prophylaxis';
}

function videoApiKey(): string
{
    return 'APIcarevelokampala01';
}

/**
 * The API secret the whole of test 2 hunts for.
 *
 * Long, and shaped like nothing else in the codebase, so a substring search over
 * a response body or a log line cannot report a false negative because the value
 * happened to be a common word.
 */
function videoApiSecret(): string
{
    return 'lksecret-4f2b9c71d0e8a35619bc7de2f04a8b13c9';
}

/**
 * Configure LiveKit as though this deployment had credentials.
 *
 * Set through the config repository rather than through the environment because
 * the suite runs against whatever .env the developer has, and a test whose result
 * depends on that is a test that passes on one machine and fails on the next.
 * AppServiceProvider binds VideoProvider through a closure that re-reads config
 * on every resolution, which is what makes this possible without rebooting the
 * application.
 */
function videoConfigureLiveKit(int $ttlSeconds = 3600): void
{
    config()->set('video.livekit.api_key', videoApiKey());
    config()->set('video.livekit.api_secret', videoApiSecret());
    config()->set('video.livekit.url', 'wss://media.carevelo.test');
    config()->set('video.livekit.token_ttl', $ttlSeconds);
}

function videoConfigureNothing(): void
{
    config()->set('video.livekit.api_key', null);
    config()->set('video.livekit.api_secret', null);
    config()->set('video.livekit.url', null);
}

function videoUrl(Tenant $tenant, string $path): string
{
    return sprintf('http://%s.%s%s', $tenant->subdomain, parse_url((string) config('app.url'), PHP_URL_HOST), $path);
}

/**
 * A confirmed video appointment, its patient's account, and the clinician.
 *
 * The patient has a real name and a real phone number and the appointment has the
 * unmistakable service attached, because a test for "none of this reaches the
 * media server" proves nothing at all against a fixture where none of it exists.
 *
 * @return array{tenant: Tenant, patientUser: User, clinician: User, appointment: Appointment, patient: Patient}
 */
function videoFixture(): array
{
    $tenant = Tenant::factory()->create();

    return app(Tenancy::class)->run($tenant->id, function () use ($tenant) {
        $account = function (string $phone, ClinicalRole $role) use ($tenant): User {
            $user = User::factory()->create(['tenant_id' => $tenant->id, 'phone' => $phone]);
            $user->assignRole($role->value);

            return $user;
        };

        $patientUser = $account('+256772000501', ClinicalRole::Patient);
        $clinician = $account('+256772000502', ClinicalRole::Clinician);

        $patient = Patient::factory()->create([
            'phone' => '+256772000501',
            'given_name' => 'Nakayiza',
            'family_name' => 'Namuddu',
        ]);
        $patient->user_id = $patientUser->id;
        $patient->save();

        $service = Service::factory()->create(['name' => videoUnmistakableService()]);

        $appointment = Appointment::factory()->create([
            'patient_id' => $patient->id,
            'service_id' => $service->id,
            'status' => AppointmentStatus::Confirmed,
            'scheduled_start_at' => Date::now()->addMinutes(5),
            'scheduled_end_at' => Date::now()->addMinutes(35),
        ]);

        return compact('tenant', 'patientUser', 'clinician', 'appointment', 'patient');
    });
}

/**
 * The two URLs a participant walks through, on the right tenant subdomain.
 *
 * The requests themselves stay in the test bodies rather than moving into a
 * shared helper, and that is not a style accident. The rules under test are about
 * what leaves the building over HTTP, so the HTTP has to be visible in the test
 * that claims it -- a helper that hid the issue-then-redeem pair would let a
 * reader believe a unit test on LiveKitVideoProvider was being asserted, and such
 * a test passes happily while the controller adds a display name on the way past.
 *
 * @param  array{tenant: Tenant, patientUser: User, clinician: User, appointment: Appointment, patient: Patient}  $fixture
 */
function videoIssueUrl(array $fixture): string
{
    return videoUrl($fixture['tenant'], '/api/v1/appointments/'.$fixture['appointment']->id.'/join-token');
}

/**
 * @param  array{tenant: Tenant, patientUser: User, clinician: User, appointment: Appointment, patient: Patient}  $fixture
 */
function videoRedeemUrl(array $fixture): string
{
    return videoUrl($fixture['tenant'], '/api/v1/join-tokens/redeem');
}

/**
 * The claims of a JOSE compact token, without a JWT library.
 *
 * Symmetrical with LiveKitAccessToken, which mints without one for the same
 * reason: nothing may be added to composer.lock. Reading it back here is also the
 * only way to assert on what is IN the token rather than on what we believe we
 * put there.
 *
 * @return array<string, mixed>
 */
function videoClaims(string $jwt): array
{
    $parts = explode('.', $jwt);

    expect($parts)->toHaveCount(3, 'A JOSE compact serialisation is three dot-separated segments.');

    $payload = base64_decode(strtr($parts[1], '-_', '+/'), true);
    $claims = is_string($payload) ? json_decode($payload, true) : null;

    expect($claims)->toBeArray();

    /** @var array<string, mixed> */
    return is_array($claims) ? $claims : [];
}

/**
 * Every log line written while the callback runs.
 *
 * Copied from h1PayCapturedLog() in tests/Feature/Api/Admin/AggregatorAccountTest.php,
 * which hunts the Pesapal consumer secret the same way. Log::listen sees
 * everything that reaches the logger, so this catches a secret escaping through a
 * debug line, a warning, or an exception trace somebody decided to report -- the
 * three routes a credential actually takes out of a system, none of which a
 * response-body assertion would notice.
 *
 * @return list<string>
 */
function videoCapturedLog(callable $callback): array
{
    $lines = [];

    Log::listen(function (MessageLogged $logged) use (&$lines): void {
        $lines[] = $logged->message.' '.(json_encode($logged->context) ?: '');
    });

    $callback();

    return $lines;
}

// --- 1. The token names a room and a role -----------------------------------

it('mints a credential naming only the room and the participant role', function () {
    // THE privacy test, and the reason VideoProvider is a two-string interface.
    // The identity in a LiveKit token is broadcast to the other participant and
    // written into the media server's operational logs, so a patient's name or
    // the reason for their visit placed here is health data in a text file on a
    // VPS, outside the tenant database and outside RLS.
    videoConfigureLiveKit();

    $f = videoFixture();

    $joinToken = $this->actingAs($f['patientUser'])
        ->postJson(videoIssueUrl($f))
        ->assertCreated()
        ->json('data.token');

    $credentials = $this->actingAs($f['patientUser'])
        ->postJson(videoRedeemUrl($f), ['token' => $joinToken])
        ->assertOk()
        ->json('data');

    expect($credentials['configured'])->toBe('true')
        ->and($credentials['provider'])->toBe('livekit')
        ->and($credentials['room'])->toBe('apt-'.$f['appointment']->id)
        ->and($credentials['participant'])->toBe('patient');

    $claims = videoClaims((string) $credentials['token']);

    // The whole identity the media server is ever given.
    expect($claims['sub'])->toBe('patient');

    $grant = $claims['video'];

    expect($grant)->toBeArray();
    expect(is_array($grant) ? $grant['room'] : null)->toBe('apt-'.$f['appointment']->id);

    // No display name, no metadata, no attributes. Their ABSENCE is the control:
    // LiveKit's own SDKs offer all three and every example in its documentation
    // sets the first.
    expect($claims)->not->toHaveKey('name')
        ->and($claims)->not->toHaveKey('metadata')
        ->and($claims)->not->toHaveKey('attributes');

    // And the same assertion made bluntly, over the entire credential payload
    // including the encoded token, because a leak would more plausibly arrive as
    // a new field than as a rewritten claim.
    $serialised = (string) json_encode($credentials);
    $decodedToken = (string) json_encode($claims);

    $mustNotAppear = [
        videoUnmistakableService(),
        'Nakayiza',
        'Namuddu',
        '+256772000501',
        (string) $f['tenant']->legal_name,
    ];

    foreach ($mustNotAppear as $leak) {
        expect(str_contains($serialised, $leak))->toBeFalse("The media credential carries '{$leak}'.")
            ->and(str_contains($decodedToken, $leak))->toBeFalse("The access token's claims carry '{$leak}'.");
    }
});

it('refuses to mint a credential for anything that is not a role', function () {
    // The guard behind JoinTokenController::labelFor(). That method returns
    // 'patient' or 'clinician' today; it is a private method one helpful
    // refactor away from returning a person, and this is what stops that landing
    // silently in a broadcast identity.
    $provider = new LiveKitVideoProvider(
        'wss://media.carevelo.test',
        new LiveKitAccessToken(videoApiKey(), videoApiSecret()),
    );

    expect(fn () => $provider->credentialsFor('apt-01J0', 'Nakayiza Namuddu'))
        ->toThrow(InvalidArgumentException::class);

    foreach (LiveKitVideoProvider::PARTICIPANT_LABELS as $label) {
        expect($provider->credentialsFor('apt-01J0', $label)['participant'])->toBe($label);
    }
});

// --- 2. The API secret leaves nowhere ---------------------------------------

it('never lets the api secret reach a response body, a log line or an audit event', function () {
    /*
     * The secret is the HMAC key over EVERY credential we mint, and a room name
     * is `apt-{ulid}` where the ulid already appears in our own API responses.
     * So anyone holding this string can mint themselves a token for a named
     * patient's consultation and walk in. That is the strongest reason in the
     * codebase for write-only discipline, and it is asserted here end to end over
     * HTTP rather than by reading the class -- because the failure it guards
     * against is a debug line somebody adds in production, not a getter.
     */
    videoConfigureLiveKit();

    $f = videoFixture();
    $bodies = [];

    $lines = videoCapturedLog(function () use ($f, &$bodies): void {
        $token = $this->actingAs($f['patientUser'])
            ->postJson(videoUrl($f['tenant'], '/api/v1/appointments/'.$f['appointment']->id.'/join-token'));

        $bodies[] = $token->assertCreated()->getContent();

        $bodies[] = $this->actingAs($f['patientUser'])
            ->postJson(videoUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => $token->json('data.token')])
            ->assertOk()
            ->getContent();

        // A redemption that FAILS, because an error path is where a credential
        // most often escapes: an exception message, a context array, a report.
        $bodies[] = $this->actingAs($f['patientUser'])
            ->postJson(videoUrl($f['tenant'], '/api/v1/join-tokens/redeem'), ['token' => str_repeat('a', 64)])
            ->assertForbidden()
            ->getContent();
    });

    foreach ($bodies as $index => $body) {
        expect(str_contains((string) $body, videoApiSecret()))->toBeFalse("Response {$index} leaked the media secret.");
    }

    foreach ($lines as $line) {
        expect(str_contains($line, videoApiSecret()))->toBeFalse('The media secret reached the log.');
    }

    $audit = app(Tenancy::class)->run(
        $f['tenant']->id,
        fn () => (string) json_encode(AuditEvent::query()->get(['action', 'metadata'])->toArray())
    );

    expect(str_contains($audit, videoApiSecret()))->toBeFalse('The media secret reached an audit event.');

    // The trail still says which transport brokered the consultation, which is
    // what makes it possible to tell later which consultations ran over our own
    // server and which ran before there was one.
    expect($audit)->toContain('livekit');
});

// --- 3. No credentials degrades, and keeps working --------------------------

it('resolves the unconfigured provider when no credentials are configured', function () {
    /*
     * Unconfigured is a WORKING state, not an error branch. It is what a
     * developer's machine, CI, a staging box and a production evening with a
     * mistyped secret all look like, and in every one of them a patient must see
     * the clinic's phone number rather than a dead room or a stack trace.
     */
    videoConfigureNothing();

    expect(app(VideoProvider::class))->toBeInstanceOf(UnconfiguredVideoProvider::class);

    $f = videoFixture();

    $joinToken = $this->actingAs($f['patientUser'])
        ->postJson(videoIssueUrl($f))
        ->assertCreated()
        ->json('data.token');

    $credentials = $this->actingAs($f['patientUser'])
        ->postJson(videoRedeemUrl($f), ['token' => $joinToken])
        ->assertOk()
        ->json('data');

    // The STRING 'false'. Both frontends coerce with `=== 'true'` because
    // Boolean('false') is true, so a real boolean here would open a dead room for
    // every patient of a clinic with no media server.
    expect($credentials['configured'])->toBe('false')
        ->and($credentials['provider'])->toBe('unconfigured')
        ->and($credentials['room'])->toBe('apt-'.$f['appointment']->id)
        ->and($credentials)->not->toHaveKey('token')
        ->and($credentials)->not->toHaveKey('url');
});

it('will not half-configure itself from a partial environment', function () {
    // A URL with no secret cannot mint a token and a secret with no URL has
    // nowhere to send one. "Partly configured" is not a state worth having: it
    // reports configured=true to the client and then fails to connect, which is
    // the honest failure disguised as a broken one.
    videoConfigureLiveKit();
    config()->set('video.livekit.api_secret', null);

    expect(app(VideoProvider::class))->toBeInstanceOf(UnconfiguredVideoProvider::class);

    videoConfigureLiveKit();
    config()->set('video.livekit.url', '');

    // The empty string, specifically: `LIVEKIT_URL=` in an .env file reads back
    // as '' rather than null and would otherwise pass a null check.
    expect(app(VideoProvider::class))->toBeInstanceOf(UnconfiguredVideoProvider::class);

    videoConfigureLiveKit();

    expect(app(VideoProvider::class))->toBeInstanceOf(LiveKitVideoProvider::class);
});

// --- 4. The signature is ours and only ours ---------------------------------

it('signs a credential that verifies against our secret and no other', function () {
    /*
     * This is the half of a JWT that LiveKitAccessToken cannot get wrong quietly.
     * A token minted with the wrong bytes, the wrong algorithm or padded base64
     * is refused by the SFU, and from the patient's side that is indistinguishable
     * from "the video doesn't work" -- so the verification LiveKit performs is
     * performed here, against a reference computed independently of the class.
     */
    $token = (new LiveKitAccessToken(videoApiKey(), videoApiSecret()))->mint('apt-01J0', 'clinician');

    $parts = explode('.', $token);
    expect($parts)->toHaveCount(3);

    $signingInput = $parts[0].'.'.$parts[1];

    $sign = fn (string $secret): string => rtrim(strtr(
        base64_encode(hash_hmac('sha256', $signingInput, $secret, true)), '+/', '-_'
    ), '=');

    expect(hash_equals($sign(videoApiSecret()), $parts[2]))->toBeTrue();
    expect(hash_equals($sign('lksecret-someone-elses-key-pair-0000000000'), $parts[2]))->toBeFalse();

    // Unpadded, because the compact serialisation forbids `=`: a padded segment
    // is rejected by conforming verifiers, which here means the SFU refusing
    // every token we mint.
    expect($token)->not->toContain('=');

    // HS256 stated in the header. `alg: none` and RS256/HS256 confusion are the
    // two historic JWT breaks, and both begin with a header nobody asserted on.
    $header = base64_decode(strtr($parts[0], '-_', '+/'), true);

    expect(is_string($header) ? $header : '')->toContain('"alg":"HS256"');
});

// --- 5. A media credential's life is bounded --------------------------------

it('bounds how long a media credential lives, whatever the environment says', function () {
    /*
     * A media credential is a key to a room where two people discuss a patient's
     * health, so its lifetime is a security property -- and a security property
     * read from an .env file is one typo from being wrong in the direction nobody
     * notices. 86400 instead of 8640 mints a key that opens a consultation room
     * until this time tomorrow, and everything keeps working, which is exactly
     * why it would survive review.
     */
    $now = Date::now()->getTimestamp();

    videoConfigureLiveKit(86_400);

    $f = videoFixture();

    $joinToken = $this->actingAs($f['patientUser'])
        ->postJson(videoIssueUrl($f))
        ->assertCreated()
        ->json('data.token');

    $credentials = $this->actingAs($f['patientUser'])
        ->postJson(videoRedeemUrl($f), ['token' => $joinToken])
        ->assertOk()
        ->json('data');

    $claims = videoClaims(is_array($credentials) ? (string) $credentials['token'] : '');

    $exp = $claims['exp'];
    $nbf = $claims['nbf'];

    expect($exp)->toBeInt()->and($nbf)->toBeInt();

    expect((int) $exp - $now)->toBeLessThanOrEqual(LiveKitAccessToken::MAX_TTL_SECONDS)
        ->and((int) $exp)->toBeGreaterThan($now);

    // Backdated, so that a media server whose clock runs a minute behind ours
    // does not refuse a token as not-yet-valid -- a consultation that fails to
    // open for one minute and then starts working is close to undiagnosable.
    expect((int) $nbf)->toBeLessThan($now + 1);

    // Clamped from below too. A configured 5 would expire before the browser
    // finished connecting, presenting as "the room never opens" with nothing in
    // any log to say why.
    expect((new LiveKitAccessToken(videoApiKey(), videoApiSecret(), 5))->ttlSeconds())
        ->toBe(LiveKitAccessToken::MIN_TTL_SECONDS);

    expect((new LiveKitAccessToken(videoApiKey(), videoApiSecret(), 86_400))->ttlSeconds())
        ->toBe(LiveKitAccessToken::MAX_TTL_SECONDS);
});

// --- Recording stays impossible ---------------------------------------------

it('grants nothing that could record a consultation', function () {
    /*
     * Consultation recording is a standing non-goal in four documents, and
     * ADR-0004's residency argument rests on there being no media store to
     * breach. Self-hosting makes this MORE tempting rather than less: Egress
     * ships in the same Apache-2.0 distribution we already run, so it costs
     * nothing to switch on and would produce a store of consultation video on a
     * server we operate.
     *
     * `roomRecord` is stated false rather than omitted so that turning it on
     * means deleting a line with a comment on it.
     */
    $claims = videoClaims((new LiveKitAccessToken(videoApiKey(), videoApiSecret()))->mint('apt-01J0', 'patient'));

    $grant = $claims['video'];

    expect($grant)->toBeArray();

    /** @var array<string, mixed> $grant */
    expect($grant['roomRecord'])->toBeFalse()
        ->and($grant['roomAdmin'])->toBeFalse()
        ->and($grant['roomList'])->toBeFalse()
        // In-consultation chat is clinical data: it travels our own Reverb
        // connection into our own database under RLS. A data channel here would
        // be a second path for the same text that crosses to the media server
        // AND leaves no record in the patient's file.
        ->and($grant['canPublishData'])->toBeFalse()
        ->and($grant['canUpdateOwnMetadata'])->toBeFalse();
});
