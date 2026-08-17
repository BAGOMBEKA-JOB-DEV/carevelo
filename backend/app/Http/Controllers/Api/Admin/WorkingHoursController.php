<?php

namespace App\Http\Controllers\Api\Admin;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\WorkingHours\UpdateWorkingHoursRequest;
use App\Http\Resources\V1\WorkingHourResource;
use App\Models\ClinicalRole;
use App\Models\User;
use App\Models\WorkingHour;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

/**
 * When the clinic is open.
 *
 * One row per day per tenant, `day_of_week` running 0 (Sunday) to 6, matching
 * Carbon. These hours are the raw material for /availability: get them wrong
 * and the clinic publishes slots nobody staffs.
 *
 * Not patient-facing. A patient asks /availability, which answers the question
 * they actually have -- "when can I be seen?" -- rather than handing them a
 * timetable to reason about.
 *
 * Authorisation is a role check written out here rather than a policy, for the
 * same reason as the service catalogue: this is clinic configuration with no
 * per-row decision to make. It is still default-deny.
 *
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 */
class WorkingHoursController extends Controller
{
    /**
     * Front desk reads it because front desk books into it.
     *
     * @var list<ClinicalRole>
     */
    private const READERS = [
        ClinicalRole::ClinicAdmin,
        ClinicalRole::Clinician,
        ClinicalRole::FrontDesk,
    ];

    /** @var list<ClinicalRole> */
    private const MANAGERS = [ClinicalRole::ClinicAdmin];

    public function __construct(protected AuditLog $audit) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $this->permitted($request, self::READERS);

        return WorkingHourResource::collection($this->week());
    }

    /**
     * Replace the whole week.
     *
     * PUT on a collection means the body IS the timetable. A day the clinic no
     * longer opens is absent, and absence must remove the row: a merge-style
     * update would leave last season's Saturday quietly published, and the
     * first anyone would know is a patient standing at a locked door.
     */
    public function update(UpdateWorkingHoursRequest $request): AnonymousResourceCollection
    {
        $this->permitted($request, self::MANAGERS);

        $week = $request->week();

        $hours = DB::transaction(function () use ($week): Collection {
            /** @var list<int> $days */
            $days = array_column($week, 'day_of_week');

            WorkingHour::query()->whereNotIn('day_of_week', $days)->delete();

            foreach ($week as $day) {
                WorkingHour::query()->updateOrCreate(
                    ['day_of_week' => $day['day_of_week']],
                    $day,
                );
            }

            // Which days the clinic opens is commercial configuration, not
            // health data about anyone, so the day numbers are safe to record.
            // They are also the part worth reconstructing when a patient
            // disputes an appointment that "could not have been offered".
            $this->audit->record(
                'working_hours.updated',
                subjectType: 'WorkingHour',
                metadata: ['days' => $days],
            );

            return $this->week();
        });

        return WorkingHourResource::collection($hours);
    }

    /** @return Collection<int, WorkingHour> */
    private function week(): Collection
    {
        return WorkingHour::query()->orderBy('day_of_week')->get();
    }

    /**
     * Default deny: only an active user holding one of `$roles` gets through.
     *
     * @param  list<ClinicalRole>  $roles
     *
     * @throws AuthorizationException
     */
    private function permitted(Request $request, array $roles): User
    {
        $user = $request->user();

        if ($user instanceof User && $user->is_active && $user->hasAnyRole(array_map(
            static fn (ClinicalRole $role): string => $role->value,
            $roles,
        ))) {
            return $user;
        }

        throw new AuthorizationException;
    }
}
