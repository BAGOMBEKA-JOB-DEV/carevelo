<?php

namespace App\Http\Requests\V1\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Reads\Concerns\ResolvesClinicDays;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the platform audit register.
 *
 * ============================================================
 * `tenant_id` IS NOT A FILTER, IT CHOOSES WHICH TRAIL IS READ
 * ============================================================
 *
 * It looks like the others and it is not, so it is worth stating here where somebody adding
 * the next filter will read it. audit_events carries the isolation policy installed by
 * Schema::enableTenantIsolationWithPlatformRows():
 *
 *     tenant context set   -> only that tenant's rows
 *     tenant context unset -> only rows with no tenant
 *
 * and its own comment is explicit that it "never lets an unset context see tenant rows.
 * Platform and tenant data stay disjoint in both directions." The platform routes bind no
 * tenant, so a request without `tenant_id` reads THE PLATFORM TRAIL and cannot see anything
 * else however this class is written. Supplying one makes the controller enter that
 * clinic's context through Tenancy::run(), which is the same door break-glass goes through
 * and the only one there is.
 *
 * The consequence a reviewer should know: one response is one trail. There is no page that
 * mixes clinics, because producing one would mean a policy that lets an unset context read
 * tenant rows -- a bypass of the control, installed permanently in the database, so that a
 * console screen could offer a firehose. Naming the clinic you are reading is a smaller
 * price, and the name is recorded on the audit event this read itself writes.
 *
 * ============================================================
 * WHAT CANNOT BE FILTERED
 * ============================================================
 *
 * Nothing in `metadata`, exactly as on the tenant endpoint: querying by metadata value
 * would turn the audit log into a search index over whatever a caller once put there, which
 * is the shape of the problem this log is supposed not to have. And on this surface the
 * platform projection does not even return that column for a clinic's events, so a filter
 * over it would be a way to ASK about a field that is deliberately not shown -- a lookup
 * oracle, which is worse than the field itself.
 *
 * Nor `subject_id`. Same reason, same class: PlatformAuditEventResource withholds it, and a
 * filter that accepted one would answer "does this clinic hold a record with this id" for
 * anybody who could guess.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */
class IndexPlatformAuditEventRequest extends FormRequest
{
    use RejectsUnknownFields;
    use ResolvesClinicDays;

    public const DEFAULT_PER_PAGE = 50;

    /**
     * A hundred, matching the break-glass register next door rather than the tenant audit
     * endpoint's two hundred. This is a cross-tenant read of somebody else's trail and the
     * page size is how much of it comes back in one request; the smaller neighbour is the
     * right neighbour to copy.
     */
    public const MAX_PER_PAGE = 100;

    /** The filters that map straight onto an indexed column. */
    private const EQUALITY_FILTERS = ['action', 'actor_id'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /*
             * `exists`, so an unknown clinic is a 422 naming the field rather than an empty
             * page that reads as "this clinic has done nothing". Not a disclosure worth
             * worrying about on this surface: the operator holding a verified platform
             * session can already list every tenant at GET /v1/platform/tenants.
             */
            'tenant_id' => ['sometimes', 'string', 'ulid', Rule::exists('tenants', 'id')],
            'action' => ['sometimes', 'string', 'max:64'],
            'actor_id' => ['sometimes', 'string', 'ulid'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    /** Which trail to read. Null means the platform's own. */
    public function tenantId(): ?string
    {
        $tenantId = $this->validated('tenant_id');

        return is_string($tenantId) && $tenantId !== '' ? $tenantId : null;
    }

    /**
     * The equality filters actually supplied.
     *
     * Returned as one array so the controller can both apply them and record them on the
     * audit event this read itself writes -- the question "what did the operator go looking
     * for?" is answered by the filters, not by the rows that came back.
     *
     * @return array<string, string>
     */
    public function equalityFilters(): array
    {
        $filters = [];

        foreach (self::EQUALITY_FILTERS as $field) {
            $value = $this->validated($field);

            if (is_string($value) && $value !== '') {
                $filters[$field] = $value;
            }
        }

        return $filters;
    }

    /**
     * Midnight at the start of the requested day.
     *
     * ResolvesClinicDays reads the timezone off the tenant ResolveTenant bound, and this
     * route runs with that middleware removed, so nothing is bound and the trait falls
     * through to its Africa/Kampala default. That is the right answer here rather than an
     * accident being tolerated: the console is operated from Kampala, every clinic on
     * Carevelo is in the same zone, and a reviewer asking for "yesterday" means the day
     * they worked. The trait is reused rather than reimplemented so there is one definition
     * of where a day begins -- and, as it says, the timezone never comes from the client: a
     * caller who could choose it could choose which day an event falls in.
     */
    public function from(): ?CarbonImmutable
    {
        return $this->dayStart('from');
    }

    /** The last instant of the requested day, so the range is inclusive. */
    public function to(): ?CarbonImmutable
    {
        return $this->dayEnd('to');
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
