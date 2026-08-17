<?php

namespace App\Providers;

use App\Support\Video\UnconfiguredVideoProvider;
use App\Support\Video\VideoProvider;
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
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
