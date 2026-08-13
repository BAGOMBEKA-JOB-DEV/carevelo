<?php

namespace App\Support;

use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Contracts\Cache\Repository;

/**
 * Cache access, namespaced by tenant.
 *
 * An unprefixed cache key is a cross-tenant leak with a time delay: tenant A's
 * data served to tenant B, intermittently, only under load. It passes every
 * functional test and appears only in production, which makes it one of the
 * three highest-consequence failures in this system.
 *
 * This class exists so a key CANNOT be built without a tenant prefix. Never
 * call Cache::get() directly for tenant data — a manually constructed key is a
 * defect on sight.
 *
 * @see docs/50-security-compliance/threat-model.md
 */
class TenantCache
{
    public function __construct(
        protected Repository $cache,
        protected TenantContext $context,
    ) {}

    /**
     * @template TValue
     *
     * @param  Closure(): TValue  $callback
     * @return TValue
     */
    public function remember(string $key, int $ttlSeconds, Closure $callback): mixed
    {
        return $this->cache->remember($this->qualify($key), $ttlSeconds, $callback);
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->cache->get($this->qualify($key), $default);
    }

    public function put(string $key, mixed $value, int $ttlSeconds): bool
    {
        return $this->cache->put($this->qualify($key), $value, $ttlSeconds);
    }

    public function forget(string $key): bool
    {
        return $this->cache->forget($this->qualify($key));
    }

    public function has(string $key): bool
    {
        return $this->cache->has($this->qualify($key));
    }

    /**
     * Prefix a key with the current tenant.
     *
     * Throws without tenant context rather than falling back to a global key —
     * a global key is precisely the bug this class prevents.
     */
    public function qualify(string $key): string
    {
        return sprintf('tenant:%s:%s', $this->context->currentOrFail(), $key);
    }
}
