<?php

namespace App\Exceptions\Tenancy;

use Exception;

/**
 * Thrown when tenant-scoped work is attempted with no tenant resolved.
 *
 * This exception is the isolation model working, not failing. The commonest
 * cause is a queued job that did not restore tenant context. The correct
 * response is to restore the context — never to remove the guard.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
class TenantContextMissing extends Exception
{
    public function __construct(string $detail = '')
    {
        parent::__construct(trim(
            'No tenant context is set, so tenant-scoped work cannot proceed. '
            .'If this is a queued job, extend TenantAwareJob. If it is a console '
            .'command or scheduled task, wrap the work in Tenancy::run(). '
            .$detail
        ));
    }
}
