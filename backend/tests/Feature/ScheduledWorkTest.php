<?php

use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;

/*
|--------------------------------------------------------------------------
| Mandatory test -- scheduled work
|--------------------------------------------------------------------------
|
| Every console command is actually scheduled.
|
| This exists because the opposite shipped. routes/console.php was the stock
| `inspire` command and nothing else, so ReconcilePaymentsCommand -- written,
| tested, and carrying the registration line in its own docblock -- was never
| invoked in any environment. The graduated poll schedule, next_poll_at and
| ReconcilePaymentIntentJob were all dead weight, and the failure was completely
| silent: nothing errored, no test failed, and a missed webhook simply left a
| patient never knowing whether they had paid.
|
| It is the same shape as two earlier defects in this repository -- an API surface
| reported complete against the wrong reference, and patients.user_id shipped as a
| column nothing ever filled. Code that exists, is tested, and is never called.
|
| So the commands are DISCOVERED FROM THE FILESYSTEM, exactly as
| SchemaConformanceTest derives its tables from the schema. A list here could
| disagree with app/Console/Commands and nothing would notice, which is the
| category of mistake being guarded against.
|
| @see docs/30-architecture/backend-laravel.md
|
*/

/**
 * The signature of every command in app/Console/Commands.
 *
 * @return list<string>
 */
function definedCommandSignatures(): array
{
    $signatures = [];

    foreach (glob(app_path('Console/Commands/*.php')) ?: [] as $path) {
        $class = 'App\\Console\\Commands\\'.basename($path, '.php');

        if (! class_exists($class)) {
            continue;
        }

        $reflection = new ReflectionClass($class);

        if ($reflection->isAbstract()) {
            continue;
        }

        $property = $reflection->getProperty('signature');
        $property->setAccessible(true);

        $signature = $property->getValue($reflection->newInstanceWithoutConstructor());

        // The name is the first token; the rest is argument syntax.
        $signatures[] = explode(' ', trim((string) $signature))[0];
    }

    return $signatures;
}

/**
 * @return list<Event>
 */
function scheduledEvents(): array
{
    return array_values(app(Schedule::class)->events());
}

it('schedules every console command it defines', function () {
    // The whole point. A command nobody scheduled does nothing, for ever, quietly.
    $scheduled = implode("\n", array_map(fn (Event $e) => $e->command ?? '', scheduledEvents()));

    $unscheduled = array_values(array_filter(
        definedCommandSignatures(),
        fn (string $name) => ! str_contains($scheduled, $name),
    ));

    expect($unscheduled)->toBeEmpty(
        "Defined but never scheduled: \n  ".implode("\n  ", $unscheduled)
        ."\nA command that is never invoked is indistinguishable from one that does nothing."
        ."\nRegister it in routes/console.php, or delete it."
    );
});

it('guards every scheduled sweep against overlapping itself', function () {
    // These sweeps DISPATCH jobs rather than doing the work inline, so two
    // concurrent runs double-dispatch: the poller would ask the aggregator twice
    // about one payment, and the release sweep would race itself over the same
    // appointment.
    $unguarded = [];

    foreach (scheduledEvents() as $event) {
        if (! $event->withoutOverlapping) {
            $unguarded[] = $event->command ?? '(closure)';
        }
    }

    expect($unguarded)->toBeEmpty(
        "Scheduled without withoutOverlapping(): \n  ".implode("\n  ", $unguarded)
    );
});

it('schedules the payment reconciliation backstop every minute', function () {
    // Named explicitly, not just counted. This is the one whose absence meant a
    // missed webhook left a payment pending for ever -- and webhooks going missing
    // is documented as ordinary in this market, not exceptional.
    $poller = collect(scheduledEvents())
        ->first(fn (Event $e) => str_contains((string) $e->command, 'payments:reconcile'));

    expect($poller)->not->toBeNull('the reconciliation sweep is not scheduled')
        ->and($poller?->expression)->toBe('* * * * *');
});

it('schedules the unpaid-slot release every minute', function () {
    // Availability excludes awaiting_payment bookings, so without this every
    // abandoned mobile-money prompt removes a slot from the clinic's calendar
    // permanently.
    $release = collect(scheduledEvents())
        ->first(fn (Event $e) => str_contains((string) $e->command, 'appointments:release-unpaid'));

    expect($release)->not->toBeNull('the unpaid-slot release is not scheduled')
        ->and($release?->expression)->toBe('* * * * *');
});
