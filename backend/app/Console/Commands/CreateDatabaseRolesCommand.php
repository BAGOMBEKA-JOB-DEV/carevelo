<?php

namespace App\Console\Commands;

use App\Console\Contracts\RunsOnDemand;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Throwable;

/**
 * Creates the two database roles the whole isolation model rests on.
 *
 * PostgreSQL exempts a table's OWNER from row-level security. So the application must
 * never own a table: it connects as `carevelo_app`, which holds NOBYPASSRLS and owns
 * nothing, while `carevelo_migrator` owns the schema and runs migrations. If those
 * were one role, every isolation policy would be silently inert — the system would
 * work perfectly and protect nothing, with no error anywhere.
 *
 * Until now this existed only as inline SQL inside .github/workflows/backend.yml,
 * which means a developer setting the project up had no way to discover the most
 * important step in it. `composer setup` called `migrate` and failed, because the
 * default connection is deliberately the role without DDL rights.
 *
 * Idempotent: safe to run against a database that already has the roles.
 *
 * Connects as a SUPERUSER, which is the one thing the application connections cannot
 * do. Pass --superuser if your local cluster does not authenticate `postgres` by trust.
 *
 * @see docs/30-architecture/multi-tenancy.md
 * @see tests/Feature/Tenancy/ConnectionRoleTest.php — asserts the result
 */
class CreateDatabaseRolesCommand extends Command implements RunsOnDemand
{
    /** @var string */
    protected $signature = 'db:roles
        {--superuser= : A role that may create roles and databases. Detected if omitted}
        {--superuser-password= : Only needed if your cluster does not trust local connections}
        {--database= : The database to grant on, defaults to DB_DATABASE}';

    /** @var string */
    protected $description = 'Create the migrator and application database roles, and grant them (local setup)';

    public function whyNotScheduled(): string
    {
        return 'A one-time setup step, run by composer setup or by hand. It creates roles '
            .'and grants privileges, which is not work that belongs on a clock.';
    }

    public function handle(): int
    {
        if (! app()->environment('local')) {
            $this->components->error(
                'db:roles is local-only. In any other environment the roles are created by '
                .'whoever provisions the database, with passwords this command does not know.'
            );

            return self::FAILURE;
        }

        $database = $this->option('database') ?: config('database.connections.pgsql.database');

        $appRole = (string) config('database.connections.pgsql.username');
        $appPassword = (string) config('database.connections.pgsql.password');
        $migratorRole = (string) config('database.connections.pgsql_migrator.username');
        $migratorPassword = (string) config('database.connections.pgsql_migrator.password');

        if ($appRole === '' || $migratorRole === '' || $appPassword === '' || $migratorPassword === '') {
            $this->components->error(
                'DB_USERNAME, DB_PASSWORD, DB_MIGRATOR_USERNAME and DB_MIGRATOR_PASSWORD must '
                .'all be set. Copy .env.example to .env first.'
            );

            return self::FAILURE;
        }

        $superuser = $this->resolveSuperuser();

        if ($superuser === null) {
            return self::FAILURE;
        }

        try {
            $this->createRoles($appRole, $appPassword, $migratorRole, $migratorPassword);
            $this->createDatabase((string) $database, $migratorRole);
            $this->grant((string) $database, $appRole, $migratorRole);
        } catch (Throwable $e) {
            $this->components->error($e->getMessage());
            $this->components->warn(
                'If authentication failed, your cluster does not trust local connections as '
                .$superuser.'. Pass --superuser=<role> and set DB_SUPERUSER_PASSWORD.'
            );

            return self::FAILURE;
        }

        $this->components->info(sprintf(
            '%s owns the schema; %s can read and write it and cannot bypass row-level security.',
            $migratorRole,
            $appRole,
        ));

        return self::SUCCESS;
    }

    /**
     * Find a role that can create roles and databases.
     *
     * Two conventions are both common and neither is wrong. A Debian or Docker
     * PostgreSQL has a superuser called `postgres`; a Homebrew install creates one named
     * after the OS user and has no `postgres` role at all. Defaulting to `postgres` made
     * `composer setup` fail on this very machine with "role postgres does not exist",
     * which is a setup script telling a newcomer their database is broken when it is
     * not.
     *
     * So each candidate is tried and the first that connects is used. An explicit
     * --superuser always wins.
     */
    private function resolveSuperuser(): ?string
    {
        $explicit = $this->option('superuser');

        $candidates = is_string($explicit) && $explicit !== ''
            ? [$explicit]
            : array_values(array_unique(array_filter([get_current_user(), 'postgres'])));

        foreach ($candidates as $candidate) {
            config([
                'database.connections.pgsql_superuser' => [
                    ...config('database.connections.pgsql'),
                    'username' => $candidate,
                    // An option rather than config: superuser credentials in
                    // config/database.php would invite something else to reach for them.
                    'password' => (string) $this->option('superuser-password'),
                    'database' => 'postgres',
                ],
            ]);

            try {
                DB::purge('pgsql_superuser');
                DB::connection('pgsql_superuser')->getPdo();

                $this->components->twoColumnDetail('superuser', $candidate);

                return $candidate;
            } catch (Throwable) {
                continue;
            }
        }

        $this->components->error(sprintf(
            'Could not connect as a superuser. Tried: %s. Pass --superuser=<role> and, if '
            .'your cluster asks for one, --superuser-password=<password>.',
            implode(', ', $candidates),
        ));

        return null;
    }

    private function createRoles(
        string $appRole,
        string $appPassword,
        string $migratorRole,
        string $migratorPassword,
    ): void {
        $connection = DB::connection('pgsql_superuser');

        foreach ([[$migratorRole, $migratorPassword], [$appRole, $appPassword]] as [$role, $password]) {
            $exists = $connection->selectOne('select 1 as found from pg_roles where rolname = ?', [$role]);

            // A role name is an IDENTIFIER, so it cannot be a bound parameter and must
            // instead be proved safe. The password is a literal and is quoted by the
            // driver. Both come from config rather than user input, but "it comes from
            // config" is how injection arrives in a codebase that later reads config
            // from somewhere else.
            $this->assertSafeIdentifier($role);

            $password = $connection->getPdo()->quote($password);

            if ($exists === null) {
                // NOBYPASSRLS on BOTH. The migrator is exempt from RLS through ownership
                // rather than through the attribute, and tables are created FORCE ROW
                // LEVEL SECURITY so even the owner is subject to policy — which is why
                // seeders have to run inside Tenancy::run().
                $connection->statement("create role {$role} login password {$password} nobypassrls");

                $this->components->twoColumnDetail($role, '<fg=green>created</>');

                continue;
            }

            $connection->statement("alter role {$role} login password {$password} nobypassrls");

            $this->components->twoColumnDetail($role, '<fg=yellow>already existed, password reset</>');
        }
    }

    /**
     * Refuse anything that is not a plain lowercase identifier.
     *
     * These values are interpolated into DDL because PostgreSQL will not accept a bound
     * parameter for an identifier. So the safety has to come from the value, not from
     * the driver.
     */
    private function assertSafeIdentifier(string $identifier): void
    {
        if (preg_match('/^[a-z_][a-z0-9_]*$/D', $identifier) !== 1) {
            throw new InvalidArgumentException(
                sprintf('"%s" is not a usable role or database name: lowercase letters, digits and underscores only.', $identifier)
            );
        }
    }

    private function createDatabase(string $database, string $migratorRole): void
    {
        $connection = DB::connection('pgsql_superuser');

        $exists = $connection->selectOne('select 1 as found from pg_database where datname = ?', [$database]);

        if ($exists !== null) {
            $this->components->twoColumnDetail($database, '<fg=yellow>already existed</>');

            return;
        }

        $this->assertSafeIdentifier($database);
        $this->assertSafeIdentifier($migratorRole);

        // Owned by the migrator, so migrations can create tables and the application
        // role cannot inherit ownership of them.
        $connection->statement("create database {$database} owner {$migratorRole}");

        $this->components->twoColumnDetail($database, '<fg=green>created</>');
    }

    private function grant(string $database, string $appRole, string $migratorRole): void
    {
        config([
            'database.connections.pgsql_grant' => [
                ...config('database.connections.pgsql_superuser'),
                'database' => $database,
            ],
        ]);

        $connection = DB::connection('pgsql_grant');

        $this->assertSafeIdentifier($appRole);
        $this->assertSafeIdentifier($migratorRole);

        // The application role gets DML on tables the migrator creates, and nothing
        // else: no CREATE on the schema, so it cannot come to own a table by accident.
        // Default privileges matter as much as the grants — they apply to tables that
        // do not exist yet, which is every table a future migration adds.
        foreach ([
            'revoke all on schema public from public',
            sprintf('grant all on schema public to %s', $migratorRole),
            sprintf('grant usage on schema public to %s', $appRole),
            sprintf(
                'alter default privileges for role %s in schema public grant select, insert, update, delete on tables to %s',
                $migratorRole,
                $appRole,
            ),
            sprintf(
                'alter default privileges for role %s in schema public grant usage, select on sequences to %s',
                $migratorRole,
                $appRole,
            ),
            // Anything already created by an earlier run.
            sprintf('grant select, insert, update, delete on all tables in schema public to %s', $appRole),
            sprintf('grant usage, select on all sequences in schema public to %s', $appRole),
        ] as $statement) {
            $connection->statement($statement);
        }

        $this->components->twoColumnDetail('grants and default privileges', '<fg=green>applied</>');
    }
}
