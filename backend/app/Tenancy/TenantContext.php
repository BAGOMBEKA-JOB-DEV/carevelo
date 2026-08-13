<?php

namespace App\Tenancy;

use App\Exceptions\Tenancy\TenantContextMissing;

/**
 * The resolved current tenant for a request, job or command.
 *
 * Its absence is a fatal error, never a default. There is deliberately no
 * "current tenant or null" accessor that a caller could mistake for "all
 * tenants": the only read is currentOrFail(), and the only way to enter context
 * outside a request is Tenancy::run().
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
class TenantContext
{
    protected ?string $tenantId = null;

    protected bool $bound = false;

    public function set(string $tenantId): void
    {
        if ($tenantId === '') {
            throw new \InvalidArgumentException('Tenant id cannot be empty.');
        }

        $this->tenantId = $tenantId;
        $this->bound = false;
    }

    public function forget(): void
    {
        $this->tenantId = null;
        $this->bound = false;
    }

    public function has(): bool
    {
        return $this->tenantId !== null;
    }

    /**
     * The current tenant id.
     *
     * Throws rather than returning null. Handing back null would push the
     * failure downstream to a query that silently matches nothing — or, if RLS
     * were ever misconfigured, everything.
     *
     * @throws TenantContextMissing
     */
    public function currentOrFail(): string
    {
        if ($this->tenantId === null) {
            throw new TenantContextMissing;
        }

        return $this->tenantId;
    }

    public function markBound(): void
    {
        $this->bound = true;
    }

    /**
     * Whether the database session variable has been applied on the connection.
     */
    public function isBound(): bool
    {
        return $this->bound && $this->tenantId !== null;
    }
}
