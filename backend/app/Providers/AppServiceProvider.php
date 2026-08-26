<?php

namespace App\Providers;

use App\Support\Video\LiveKitAccessToken;
use App\Support\Video\LiveKitVideoProvider;
use App\Support\Video\UnconfiguredVideoProvider;
use App\Support\Video\VideoProvider;
use Dedoc\Scramble\Scramble;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        /*
         * Consultation media sits behind an interface, and ADR-0004 has now
         * chosen what goes behind it: LiveKit, on a server we operate ourselves,
         * decided on cost. That ADR's claim of reversibility was the reason for
         * the interface, and this closure is the receipt -- choosing a provider
         * turned out to be exactly this one binding, and nothing above the
         * interface learned anything.
         *
         * CONFIGURED IS A RUNTIME QUESTION, NOT A DEPLOY-TIME ONE, WHICH IS WHY
         * THIS IS A CLOSURE AND NOT A CLASS NAME. The credentials come from the
         * environment, so the answer differs between production, a developer's
         * machine with no LiveKit running, and CI -- and it is resolved per
         * container resolution rather than frozen at boot, which is also what
         * lets a test set config and get the other branch without rebooting the
         * application.
         *
         * UNCONFIGURED IS NOT AN ERROR BRANCH. It is the degradation, and it has
         * to keep working: with no credentials a patient sees the clinic's phone
         * number and a "video is not available" line, not a dead room and not a
         * 500. That is the same shape the payments module already uses for a
         * clinic with no aggregator account -- say so, and fall back. Deleting
         * UnconfiguredVideoProvider once LiveKit is live would trade a working
         * fallback for an outage.
         *
         * All three values are required together. A URL with no secret cannot
         * mint a token, and a secret with no URL has nowhere to send one, so
         * "partly configured" is not a state worth having: it is unconfigured.
         */
        $this->app->bind(VideoProvider::class, function (): VideoProvider {
            $apiKey = $this->configuredString('video.livekit.api_key');
            $apiSecret = $this->configuredString('video.livekit.api_secret');
            $url = $this->configuredString('video.livekit.url');

            if ($apiKey === null || $apiSecret === null || $url === null) {
                return new UnconfiguredVideoProvider;
            }

            $ttl = config('video.livekit.token_ttl');

            return new LiveKitVideoProvider($url, new LiveKitAccessToken(
                $apiKey,
                $apiSecret,
                // LiveKitAccessToken clamps this between its own floor and
                // ceiling, so a non-numeric or absent value falls back to the
                // default rather than to zero -- which would mint a credential
                // that has already expired.
                is_numeric($ttl) ? (int) $ttl : LiveKitAccessToken::DEFAULT_TTL_SECONDS,
            ));
        });

        /*
         * Scramble generates the OpenAPI document the frontend's client is built
         * from. It must NOT also serve it.
         *
         * Left alone it registers `docs/api` and `docs/api.json`, which would
         * publish the complete API contract of a health platform on an
         * unauthenticated route, and serve a UI out of a tree that is API-only by
         * ADR-0007 — its Blade views were caught by the tree-boundary test within a
         * minute of being published, which is what that test is for.
         *
         * The document is produced by `scramble:export` during development and
         * committed to docs/40-api/openapi.yaml. Nothing serves it at runtime.
         *
         * class_exists because Scramble is a DEV dependency: in production the
         * class is absent and this must not fatal.
         */
        if (class_exists(Scramble::class)) {
            Scramble::ignoreDefaultRoutes();
        }
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void {}

    /**
     * A configuration value that is actually set, or null.
     *
     * An empty string is not a configured credential. `LIVEKIT_API_SECRET=` in an
     * .env file reads back as the empty string rather than null, which would
     * otherwise pass a `!== null` check and mint tokens signed with nothing at
     * all -- a signature every LiveKit server would reject, presenting as
     * "configured, and every consultation fails to connect" instead of the honest
     * "not configured".
     */
    private function configuredString(string $key): ?string
    {
        $value = config($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
