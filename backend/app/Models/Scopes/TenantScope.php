<?php

namespace App\Models\Scopes;

use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Adds `where tenant_id = ?` to Eloquent queries.
 *
 * A convenience layer, not the control — see BelongsToTenant.
 *
 * No-ops when there is no tenant context rather than throwing: RLS already
 * returns zero rows in that case, and throwing here would break legitimate
 * platform-scoped queries that touch a tenant model through a relation.
 */
/**
 * @implements Scope<Model>
 */
class TenantScope implements Scope
{
    /**
     * @param  Builder<covariant Model>  $builder
     */
    public function apply(Builder $builder, Model $model): void
    {
        $context = app(TenantContext::class);

        if (! $context->has()) {
            return;
        }

        $builder->where($model->qualifyColumn('tenant_id'), $context->currentOrFail());
    }
}
