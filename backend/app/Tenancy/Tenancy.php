<?php

namespace App\Tenancy;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\DatabaseManager;
use Throwable;

/**
 * The single entry point for entering tenant context outside an HTTP request.
 *
 * Queued jobs, console commands, scheduled tasks and seeders all go through
 * run(). There is no other supported route, because every alternative is a way
 * to forget.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
class Tenancy
{
    /**
     * The PostgreSQL session variable the RLS policies read.
     *
     * Set with set_config(..., true), the function form of SET LOCAL, so it is
     * scoped to the transaction and cannot leak across a pooled connection.
     * This is why any connection pooler must run in transaction mode.
     */
    public const TENANT_SETTING = 'app.tenant_id';

    public function __construct(
        protected TenantContext $context,
        protected DatabaseManager $db,
    ) {}

    /**
     * Execute a callback inside a tenant's context, restoring the previous one.
     *
     * Runs inside a transaction because the tenant setting is transaction
     * scoped. Nesting restores the outer tenant on the way out, so a command
     * iterating tenants cannot bleed the last one into whatever runs next.
     *
     * @template TReturn
     *
     * @param  callable(): TReturn  $callback
     * @return TReturn
     */
    public function run(string $tenantId, callable $callback): mixed
    {
        $previousId = $this->context->has() ? $this->context->currentOrFail() : null;

        // The database setting must be captured and restored explicitly, not
        // left to the transaction to unwind.
        //
        // set_config(..., true) is TRANSACTION scoped. When run() is called
        // while a transaction is already open — which is always the case under
        // DatabaseTransactions in tests, and happens in production whenever a
        // request opens one — Laravel issues a SAVEPOINT rather than a new
        // transaction, and releasing a savepoint does NOT restore the previous
        // setting. Without this, the tenant would silently persist beyond the
        // end of run(), and the next query would execute as the wrong tenant.
        $previousSetting = $this->currentSetting();

        $this->context->set($tenantId);

        try {
            return $this->db->connection()->transaction(function () use ($callback) {
                $this->bind($this->db->connection());

                return $callback();
            });
        } finally {
            // Restore whatever happened. An exception must not leave the next
            // piece of work running as the wrong tenant.
            if ($previousId !== null) {
                $this->context->set($previousId);
            } else {
                $this->context->forget();
            }

            $this->applySetting($previousSetting);
        }
    }

    /**
     * The tenant currently applied to the database session, if any.
     *
     * An empty string rather than null when unset, which is what set_config
     * stores. Either way the RLS comparison matches no rows.
     */
    protected function currentSetting(): string
    {
        /** @var object{value: ?string} $row */
        $row = $this->db->connection()->selectOne(
            'SELECT current_setting(?, true) AS value',
            [self::TENANT_SETTING]
        );

        return $row->value ?? '';
    }

    protected function applySetting(string $tenantId): void
    {
        $this->db->connection()->statement('SELECT set_config(?, ?, true)', [
            self::TENANT_SETTING,
            $tenantId,
        ]);
    }

    /**
     * Apply the resolved tenant to the database session.
     *
     * The value is bound as a parameter rather than interpolated. Tenant ids
     * are ULIDs and could not realistically carry SQL, but this is the one
     * statement that decides which tenant's data is visible, and "could not
     * realistically" is not a security property.
     */
    public function bind(ConnectionInterface $connection): void
    {
        $connection->statement('SELECT set_config(?, ?, true)', [
            self::TENANT_SETTING,
            $this->context->currentOrFail(),
        ]);

        $this->context->markBound();
    }

    /**
     * Clear the tenant from both the context and the database session.
     *
     * Used by the request lifecycle and by tests. Leaves the session in the
     * fail-closed state where no rows match.
     */
    public function forget(): void
    {
        $this->context->forget();
        $this->applySetting('');
    }

    /**
     * Run a callback for each tenant, in isolation.
     *
     * A failure for one tenant is collected rather than aborting the rest: one
     * clinic's bad data must not stop every other clinic's reminders.
     *
     * @param  iterable<int, string>  $tenantIds
     * @param  callable(string): void  $callback
     * @return array<string, Throwable> keyed by tenant id
     */
    public function forEach(iterable $tenantIds, callable $callback): array
    {
        $failures = [];

        foreach ($tenantIds as $tenantId) {
            try {
                $this->run($tenantId, static fn () => $callback($tenantId));
            } catch (Throwable $e) {
                $failures[$tenantId] = $e;
            }
        }

        return $failures;
    }

    public function current(): string
    {
        return $this->context->currentOrFail();
    }

    public function has(): bool
    {
        return $this->context->has();
    }
}
