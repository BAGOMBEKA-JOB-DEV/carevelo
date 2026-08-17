<?php

namespace App\Jobs;

use App\Tenancy\Tenancy;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Base class for every queued job that touches tenant data.
 *
 * THE QUEUE HAZARD
 *
 * A job serialised during tenant A's request and executed later by a worker has
 * no tenant context — the request that had it is long gone. With RLS active the
 * job then sees zero rows and fails loudly, which is the correct failure. But
 * "fails loudly" still means broken notifications, so the tenant is captured at
 * construction and restored at execution.
 *
 * Enforced by an architecture test: any ShouldQueue class must extend this or
 * be explicitly marked platform-scoped.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
abstract class TenantAwareJob implements ShouldQueue
{
    use Queueable;

    /**
     * Captured at construction, in the dispatching request's context.
     *
     * NOT `readonly`, and that is not an oversight.
     *
     * PHP scopes a reflective readonly initialisation to the OBJECT's class rather
     * than the declaring one. SerializesModels::__unserialize() reflects over
     * `new ReflectionClass($this)` and calls setValue, so restoring a payload threw
     * "Cannot initialize readonly property App\Jobs\TenantAwareJob::$tenantId from
     * scope <subclass>" — on every driver that serialises, which is all of them
     * except sync-without-serialisation.
     *
     * The effect was total: no notification ever sent, no prescription document ever
     * rendered, no payment reconciliation poll ever run, and a one-time code request
     * returning a 500 so nobody could sign in at all. It stayed invisible because
     * every suite fakes the queue instead of round-tripping a payload, and it was
     * diagnosed and written down in RenderPrescriptionDocumentJob's docblock without
     * being fixed — deferred to "the owner of that file", who did not exist.
     *
     * TenantAwareJobPayloadTest now round-trips every descendant through a real
     * payload, which is the test that would have caught it.
     *
     * Immutability is intent here rather than enforcement: it is written once in the
     * constructor and read once in handle().
     */
    public string $tenantId;

    public function __construct()
    {
        // Deliberately at construction, not at handling: at construction we are
        // still inside the request that knows the tenant. Resolving later would
        // be resolving from nothing.
        $this->tenantId = app(TenantContext::class)->currentOrFail();
    }

    final public function handle(): void
    {
        app(Tenancy::class)->run($this->tenantId, function (): void {
            $this->handleForTenant();
        });
    }

    /**
     * The job body. Runs with tenant context bound and RLS active.
     */
    abstract protected function handleForTenant(): void;

    /**
     * Horizon tags, so a tenant's jobs can be found without a cross-tenant
     * query. Deliberately the tenant id only — never a patient identifier and
     * never anything clinical.
     *
     * @return list<string>
     */
    public function tags(): array
    {
        return ['tenant:'.$this->tenantId, 'job:'.static::class];
    }
}
