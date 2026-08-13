<?php

namespace App\Models\Concerns;

use App\Models\Scopes\TenantScope;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * Applied to every tenant-scoped Eloquent model.
 *
 * IMPORTANT: this is a convenience layer, not the control.
 *
 * The control is PostgreSQL row-level security. This trait scopes ordinary
 * Eloquent reads without every call site remembering, and fills tenant_id on
 * create. It does NOT make the model safe — DB::table(), raw SQL,
 * withoutGlobalScopes() and Model::find() all bypass it, and only RLS stops
 * those.
 *
 * If you find yourself relying on this trait for security, re-read
 * docs/30-architecture/multi-tenancy.md
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope);

        // Fill tenant_id on create. Throws without context: writing tenant data
        // without knowing the tenant is a bug, and RLS would reject the row
        // anyway — failing here gives a far better message.
        static::creating(function (Model $model): void {
            if ($model->getAttribute('tenant_id') === null) {
                $model->setAttribute('tenant_id', app(TenantContext::class)->currentOrFail());
            }
        });

        // tenant_id is immutable. Reassigning it would move a record between
        // clinics, which is never legitimate — and RLS WITH CHECK would reject
        // it, so this is a clearer error rather than a new rule.
        static::updating(function (Model $model): void {
            if ($model->isDirty('tenant_id')) {
                throw new LogicException(sprintf(
                    'tenant_id is immutable; attempted to move %s %s between tenants.',
                    $model::class,
                    (string) $model->getKey(),
                ));
            }
        });
    }

    /**
     * @return BelongsTo<Tenant, $this>
     */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Escape hatch for platform-level queries.
     *
     * Removes the Eloquent scope only. RLS still applies, so this cannot reach
     * another tenant's rows — it exists for queries that legitimately run
     * without a resolved tenant, not to cross the boundary.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeWithoutTenantScope(Builder $query): Builder
    {
        return $query->withoutGlobalScope(TenantScope::class);
    }
}
