<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Health endpoints.
 *
 * None of them reveals anything about tenants: no names, no subdomains, no
 * counts, no identifiers. Whoever can reach the load balancer can reach these,
 * and "which clinics use Carevelo" is not a fact we publish -- a customer list
 * of competing private clinics is commercially sensitive before it is anything
 * else.
 *
 * They also carry no detail an attacker could use: a driver exception naming a
 * host, a port or a role is reconnaissance, so failures are reported by
 * dependency and by check, never by message.
 *
 * @see docs/30-architecture/observability.md
 */
class HealthController extends Controller
{
    /**
     * Liveness: this process is running.
     *
     * It touches nothing. A liveness probe that queried the database would
     * restart healthy application containers during a database incident, which
     * turns a recoverable outage into a thundering herd.
     */
    public function live(): JsonResponse
    {
        return new JsonResponse(['status' => 'alive']);
    }

    /**
     * Readiness: the dependencies needed to serve a request are reachable.
     *
     * Database, Redis and storage. A 503 takes this instance out of the load
     * balancer rather than serving errors to patients.
     */
    public function ready(): JsonResponse
    {
        $checks = [
            'database' => $this->probe(fn () => DB::select('select 1')),
            'redis' => $this->probe(fn () => Redis::connection()->command('ping')),
            'storage' => $this->probe(function (): void {
                // A write, not a read: a disk that has filled or lost its mount
                // still answers reads from cache, and the thing this process
                // needs is the ability to put a rendered document somewhere.
                $disk = Storage::disk();
                $disk->put('health/readiness-probe', 'ok');
                $disk->delete('health/readiness-probe');
            }),
        ];

        $ready = ! in_array('unavailable', $checks, true);

        return new JsonResponse(
            ['status' => $ready ? 'ready' : 'not_ready', 'checks' => $checks],
            $ready ? Response::HTTP_OK : Response::HTTP_SERVICE_UNAVAILABLE,
        );
    }

    /**
     * The isolation check. A SECURITY check, not an uptime check.
     *
     * PostgreSQL exempts a table's OWNER from row-level security. If the
     * application role owns a table -- or merely holds the right to create one,
     * which is the same thing one careless migration later -- every isolation
     * policy becomes inert. The system then works perfectly and protects
     * nothing: there is no error, no warning, and no behavioural test anywhere
     * that notices. That is why it is asserted here rather than assumed.
     *
     * A cross-tenant leak is a notifiable breach affecting two data controllers
     * at once, so this failing is not a degraded service. It is an incident.
     *
     * @see docs/50-security-compliance/threat-model.md
     */
    public function isolation(): JsonResponse
    {
        /** @var object{can_bypass: bool, is_super: bool, can_create: bool} $role */
        $role = DB::selectOne(
            'select coalesce((select rolbypassrls from pg_roles where rolname = current_user), true) as can_bypass,
                    coalesce((select rolsuper     from pg_roles where rolname = current_user), true) as is_super,
                    has_schema_privilege(current_user, ?, ?) as can_create',
            ['public', 'CREATE']
        );

        // tableowner = current_user, so this is the question that matters:
        // does the role THIS connection is using own anything it queries?
        $owned = DB::select(
            'select tablename from pg_tables where schemaname = ? and tableowner = current_user order by tablename',
            ['public']
        );

        $checks = [
            'role_cannot_bypass_rls' => $this->verdict(! $role->can_bypass && ! $role->is_super),
            'role_owns_no_table' => $this->verdict($owned === []),
            'role_cannot_create_tables' => $this->verdict(! $role->can_create),
        ];

        $isolated = ! in_array('fail', $checks, true);

        return new JsonResponse([
            'status' => $isolated ? 'isolated' : 'compromised',
            'checks' => $checks,
            // A count, never the table names: enough to tell an operator how
            // wide the problem is without publishing the schema.
            'owned_table_count' => count($owned),
        ], $isolated ? Response::HTTP_OK : Response::HTTP_SERVICE_UNAVAILABLE);
    }

    /**
     * Run a dependency probe, reducing any failure to one word.
     *
     * @param  callable(): mixed  $check
     */
    private function probe(callable $check): string
    {
        try {
            $check();

            return 'ok';
        } catch (Throwable) {
            // Swallowed deliberately. The exception message would name hosts,
            // ports and sometimes credentials, and this response is unprivileged.
            return 'unavailable';
        }
    }

    private function verdict(bool $passed): string
    {
        return $passed ? 'pass' : 'fail';
    }
}
