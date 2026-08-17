<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| Scheduled work
|--------------------------------------------------------------------------
|
| This file was the stock `inspire` command and nothing else, which meant that
| every automatic behaviour the documentation specifies was dead weight: the
| commands existed, were tested, and were never invoked. ReconcilePaymentsCommand
| even carried the line to register it in its own docblock.
|
| The consequences were not subtle. Without the reconciliation sweep a missed
| webhook — ordinary in this market — left a payment pending for ever, so a patient
| never learned whether they had paid. Without the release sweep every abandoned
| mobile-money prompt removed a slot from the clinic's calendar permanently.
|
| ScheduledWorkTest asserts that every command in app/Console/Commands appears
| below, because a command written and never scheduled is silent.
|
| DEPLOYMENT: none of this runs unless `php artisan schedule:run` is invoked every
| minute and a queue worker is processing jobs — these sweeps dispatch rather than
| do. @see docs/30-architecture/environments-and-deployment.md
|
*/

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * withoutOverlapping and onOneServer on every entry.
 *
 * These sweeps dispatch jobs, so two concurrent runs double-dispatch: the poller
 * would poll an aggregator twice for one payment, and the release sweep would race
 * itself over the same appointment. Both rely on a cache lock, so a deployment
 * running more than one scheduler needs a SHARED cache store — the array driver
 * that the test suite uses is per-process and would not prevent anything.
 */

// Every minute, but it does not poll everything every minute: the command selects
// only intents whose next poll is due under PaymentIntent::POLL_SCHEDULE.
Schedule::command('payments:reconcile')
    ->everyMinute()
    ->withoutOverlapping()
    ->onOneServer();

// Also every minute. A slot released a minute late is a minute in which another
// patient could not book it, and the whole point is to give it back.
Schedule::command('appointments:release-unpaid')
    ->everyMinute()
    ->withoutOverlapping()
    ->onOneServer();

// Quarter-hourly is ample: the resume window is an hour, and nobody is waiting on
// the outcome the way a patient waits to know whether their payment landed.
Schedule::command('consultations:abandon-stale')
    ->everyFifteenMinutes()
    ->withoutOverlapping()
    ->onOneServer();
