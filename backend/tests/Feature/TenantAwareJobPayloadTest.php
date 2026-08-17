<?php

use App\Exceptions\Tenancy\TenantContextMissing;
use App\Jobs\SendNotificationJob;
use App\Jobs\TenantAwareJob;
use App\Models\Tenant;
use App\Tenancy\Tenancy;

/*
|--------------------------------------------------------------------------
| Mandatory test -- a queued job survives a real payload
|--------------------------------------------------------------------------
|
| Every TenantAwareJob is serialised on dispatch and restored by a worker. This test
| does that round trip for real, because faking the queue does not.
|
| It exists because the alternative shipped. TenantAwareJob::$tenantId was
| `public readonly`, and PHP scopes a reflective readonly initialisation to the
| OBJECT's class rather than the declaring one -- so
| SerializesModels::__unserialize(), which reflects over `new ReflectionClass($this)`,
| threw on every restore. Nothing queued could ever run: no notification sent, no
| prescription document rendered, no payment poll made, and a one-time code request
| returning 500 so nobody could sign in.
|
| 692 tests passed throughout. Every one of them called Queue::fake(), which records
| that a job was dispatched and never asks whether it could be restored. The defect
| was even diagnosed and written into a docblock, then left for "the owner of that
| file" -- and there was no owner.
|
| So the assertion here is deliberately the crude one: serialise, unserialise, and see
| whether the tenant survived. Discovered from the filesystem, so a new job is covered
| the day it is written.
|
| @see docs/30-architecture/multi-tenancy.md
|
*/

/**
 * Every concrete TenantAwareJob descendant.
 *
 * @return list<class-string<TenantAwareJob>>
 */
function tenantAwareJobClasses(): array
{
    $classes = [];

    foreach (glob(app_path('Jobs/*.php')) ?: [] as $path) {
        $class = 'App\\Jobs\\'.basename($path, '.php');

        if (! class_exists($class) || ! is_subclass_of($class, TenantAwareJob::class)) {
            continue;
        }

        if ((new ReflectionClass($class))->isAbstract()) {
            continue;
        }

        $classes[] = $class;
    }

    return $classes;
}

it('finds the queued jobs to check', function () {
    // A guard on the guard: if the discovery silently returned nothing, every
    // assertion below would pass without testing anything.
    expect(tenantAwareJobClasses())->not->toBeEmpty();
});

it('restores every tenant-aware job from a serialised payload', function () {
    // THE test. Laravel's queue drivers serialise the job and a worker unserialises
    // it; if that round trip throws, the job never runs and the failure is silent
    // until someone notices the notifications stopped.
    $tenant = Tenant::factory()->create();

    foreach (tenantAwareJobClasses() as $class) {
        $job = app(Tenancy::class)->run($tenant->id, function () use ($class) {
            // Every descendant takes exactly one identifier plus the captured tenant.
            $parameters = (new ReflectionClass($class))->getConstructor()?->getParameters() ?? [];

            return new $class(...array_fill(0, count($parameters), '01HZZZZZZZZZZZZZZZZZZZZZZZ'));
        });

        $restored = unserialize(serialize($job));

        expect($restored)->toBeInstanceOf($class)
            ->and($restored->tenantId)->toBe(
                $tenant->id,
                $class.' lost its tenant in the payload; the worker would query with no tenant bound'
            );
    }
});

it('captures the tenant at construction, not at handling', function () {
    // By the time a worker picks the job up, the request that knew the tenant is gone.
    // Resolving then would be resolving from nothing, and with RLS active the job
    // would see zero rows and fail — correctly, but still broken.
    $tenant = Tenant::factory()->create();

    $job = app(Tenancy::class)->run(
        $tenant->id,
        fn () => new SendNotificationJob('01HZZZZZZZZZZZZZZZZZZZZZZZ')
    );

    // Outside any tenant context, the job still knows which clinic it belongs to.
    expect($job->tenantId)->toBe($tenant->id);
});

it('refuses to be constructed with no tenant bound', function () {
    // Constructing outside a request is a bug, and it should announce itself at the
    // point of the mistake rather than in a worker log at 3am.
    new SendNotificationJob('01HZZZZZZZZZZZZZZZZZZZZZZZ');
})->throws(TenantContextMissing::class);
