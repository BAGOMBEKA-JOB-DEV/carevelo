<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Service;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WorkingHour;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\Rule;

/**
 * When a patient can actually be seen.
 *
 * Three inputs, intersected: the clinic's working hours, the clinician's
 * existing bookings, and the service's own duration. Nothing here is guessed --
 * a slot is offered only if the clinic is open for the whole of it and the
 * clinician is free for the whole of it.
 *
 * TIMEZONE. Working hours are wall-clock facts in the clinic's own timezone
 * ("we open at eight"), while appointments are instants. Slots are therefore
 * generated in the tenant's timezone and compared against appointments as
 * absolute moments. Computing in UTC because the server runs in UTC would move
 * a Kampala clinic's day by three hours -- and the failure is invisible in any
 * test whose fixtures are all in one zone.
 *
 * THE ANSWER IS ADVISORY. Booking re-checks the slot inside a transaction,
 * because two patients can read the same free slot a millisecond apart. This
 * endpoint narrows the race; it does not decide it.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 * @see docs/40-api/endpoint-catalogue.md
 */
class AvailabilityController extends Controller
{
    /**
     * Statuses that occupy a clinician's slot.
     *
     * The SAME list booking enforces, deliberately. Offering a slot that
     * POST /appointments will then reject is worse than offering nothing: the
     * patient has chosen a time, entered their details, and is told no. That
     * includes `awaiting_payment`, because a prepaid booking holds its slot
     * while the patient completes a mobile-money prompt.
     *
     * @var list<AppointmentStatus>
     */
    private const SLOT_HOLDING = [
        AppointmentStatus::AwaitingPayment,
        AppointmentStatus::Confirmed,
        AppointmentStatus::InProgress,
    ];

    /** A fortnight, which is as far ahead as a clinic realistically commits. */
    private const DEFAULT_WINDOW_DAYS = 13;

    private const MAX_WINDOW_DAYS = 60;

    /**
     * A ceiling on the response, not on the clinic.
     *
     * Ten clinicians over sixty days of ten-minute slots is tens of thousands
     * of entries. Building them costs a shared database real work, and no
     * client renders them.
     */
    private const MAX_SLOTS = 500;

    /**
     * @var list<ClinicalRole>
     */
    private const READERS = [
        ClinicalRole::ClinicAdmin,
        ClinicalRole::Clinician,
        ClinicalRole::FrontDesk,
        ClinicalRole::Patient,
    ];

    public function index(Request $request): JsonResponse
    {
        $this->permitted($request);

        $validated = $request->validate([
            // Required: without a service there is no slot length, and a
            // guessed default would publish slots the clinic never sized.
            // Scoped to active services -- a withdrawn service is not bookable
            // by anyone, so it has no availability to report.
            'service_id' => [
                'required', 'string', 'ulid',
                Rule::exists('services', 'id')->where('is_active', true),
            ],
            // Optional. Absent means every clinician, which is what a patient
            // with no preference is asking for.
            'clinician_id' => ['nullable', 'string', 'ulid', 'exists:clinicians,id'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $timezone = $this->clinicTimezone($request);

        $service = Service::query()
            ->where('is_active', true)
            ->findOrFail((string) $validated['service_id']);

        $duration = (int) $service->duration_minutes;
        [$from, $to] = $this->window($validated, $timezone);

        $clinicianQuery = Clinician::query()->orderBy('id');

        if (isset($validated['clinician_id'])) {
            $clinicianQuery->whereKey((string) $validated['clinician_id']);
        }

        $clinicians = $clinicianQuery->get();

        return new JsonResponse([
            'data' => $this->slots(array_values($clinicians->all()), $duration, $from, $to, $timezone),
            'meta' => [
                'service_id' => $service->id,
                'duration_minutes' => $duration,
                'timezone' => $timezone,
                'from' => $from->toIso8601String(),
                'to' => $to->toIso8601String(),
            ],
        ]);
    }

    /**
     * Walk the window, day by day and clinician by clinician.
     *
     * @param  list<Clinician>  $clinicians
     * @return list<array{clinician_id: string, starts_at: string, ends_at: string}>
     */
    private function slots(array $clinicians, int $duration, Carbon $from, Carbon $to, string $timezone): array
    {
        if ($clinicians === [] || $duration < 1) {
            return [];
        }

        $hours = WorkingHour::query()->get()->keyBy('day_of_week');
        $busy = $this->busyPeriods($clinicians, $from, $to);

        // In the clinic's timezone, so "already past" means past for the clinic.
        $now = Date::now($timezone);

        $slots = [];

        foreach ($clinicians as $clinician) {
            $taken = $busy[$clinician->id] ?? [];

            for ($day = $from->copy(); $day->lessThanOrEqualTo($to); $day->addDay()) {
                $hour = $hours->get($day->dayOfWeek);

                // No row for the day is the same answer as a closed one: a
                // clinic that has not configured Sunday is not open on Sunday.
                if (! $hour instanceof WorkingHour || $hour->is_closed) {
                    continue;
                }

                $closes = $hour->closesOn($day);

                for (
                    $start = $hour->opensOn($day);
                    // The whole slot must fit inside opening hours. A
                    // consultation that runs past closing is one the clinic
                    // cannot staff.
                    $start->copy()->addMinutes($duration)->lessThanOrEqualTo($closes);
                    $start->addMinutes($duration)
                ) {
                    $end = $start->copy()->addMinutes($duration);

                    if ($start->lessThanOrEqualTo($now) || $this->overlaps($taken, $start, $end)) {
                        continue;
                    }

                    $slots[] = [
                        'clinician_id' => $clinician->id,
                        'starts_at' => $start->toIso8601String(),
                        'ends_at' => $end->toIso8601String(),
                    ];

                    if (count($slots) >= self::MAX_SLOTS) {
                        break 3;
                    }
                }
            }
        }

        return $slots;
    }

    /**
     * Existing bookings that consume part of the window, keyed by clinician.
     *
     * One query for every clinician rather than one per clinician: availability
     * is the most-called read in the product, and an N+1 here is felt by every
     * patient on the platform.
     *
     * @param  list<Clinician>  $clinicians
     * @return array<string, list<array{0: Carbon, 1: Carbon}>>
     */
    private function busyPeriods(array $clinicians, Carbon $from, Carbon $to): array
    {
        $appointments = Appointment::query()
            ->whereIn('clinician_id', array_map(
                static fn (Clinician $clinician): string => $clinician->id,
                $clinicians,
            ))
            ->whereIn('status', array_map(
                static fn (AppointmentStatus $status): string => $status->value,
                self::SLOT_HOLDING,
            ))
            ->where('scheduled_start_at', '<', $to)
            ->where('scheduled_end_at', '>', $from)
            ->get(['clinician_id', 'scheduled_start_at', 'scheduled_end_at']);

        $busy = [];

        foreach ($appointments as $appointment) {
            $busy[(string) $appointment->clinician_id][] = [
                Date::parse($appointment->scheduled_start_at),
                Date::parse($appointment->scheduled_end_at),
            ];
        }

        return $busy;
    }

    /**
     * Whether a booking already covers part of this slot.
     *
     * Half-open comparison, matching booking: an appointment ending at 09:30
     * does not collide with a slot starting at 09:30, which is how a
     * back-to-back clinic list is meant to read.
     *
     * @param  list<array{0: Carbon, 1: Carbon}>  $taken
     */
    private function overlaps(array $taken, Carbon $start, Carbon $end): bool
    {
        foreach ($taken as [$busyStart, $busyEnd]) {
            if ($busyStart->lessThan($end) && $busyEnd->greaterThan($start)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The requested window, defaulted and capped.
     *
     * @param  array<string, mixed>  $validated
     * @return array{Carbon, Carbon}
     */
    private function window(array $validated, string $timezone): array
    {
        $from = isset($validated['from'])
            ? Date::parse((string) $validated['from'], $timezone)->startOfDay()
            : Date::now($timezone)->startOfDay();

        $to = isset($validated['to'])
            ? Date::parse((string) $validated['to'], $timezone)->endOfDay()
            : $from->copy()->addDays(self::DEFAULT_WINDOW_DAYS)->endOfDay();

        // A clinic's timetable repeats, so nothing is learned past the cap --
        // while generating five years of slots is real work for a database
        // several clinics share.
        $ceiling = $from->copy()->addDays(self::MAX_WINDOW_DAYS)->endOfDay();

        return [$from, $to->greaterThan($ceiling) ? $ceiling : $to];
    }

    /**
     * The clinic's timezone, from the tenant resolved by middleware.
     *
     * Never from the request: a client-supplied timezone would let a patient
     * shift a clinic's opening hours by asking nicely.
     */
    private function clinicTimezone(Request $request): string
    {
        $tenant = $request->attributes->get('tenant');
        $timezone = $tenant instanceof Tenant ? $tenant->getAttribute('timezone') : null;

        return is_string($timezone) && $timezone !== ''
            ? $timezone
            : (string) config('app.timezone');
    }

    /**
     * Default deny.
     *
     * @throws AuthorizationException
     */
    private function permitted(Request $request): User
    {
        $user = $request->user();

        if ($user instanceof User && $user->is_active && $user->hasAnyRole(array_map(
            static fn (ClinicalRole $role): string => $role->value,
            self::READERS,
        ))) {
            return $user;
        }

        throw new AuthorizationException;
    }
}
