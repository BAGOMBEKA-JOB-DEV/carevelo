<?php

namespace App\Providers;

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
         * Consultation media sits behind an interface because ADR-0004 has not
         * chosen a provider yet: the decision waits on performance measurements
         * over East African mobile networks, which is a commercial and field
         * question rather than a code one.
         *
         * Binding it here is what makes that ADR's claim of reversibility true.
         * Nothing above the interface knows which provider is in use, so choosing
         * one is a single line in this file.
         */
        $this->app->bind(VideoProvider::class, UnconfiguredVideoProvider::class);

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
}
