<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Reads\IndexNotificationRequest;
use App\Http\Resources\V1\OutboundNotificationResource;
use App\Models\ClinicalRole;
use App\Models\OutboundNotification;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Notifications\NotificationChannel;
use App\Support\Notifications\NotificationStatus;
use App\Support\Notifications\NotificationTemplate;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\TemplateRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The notification administration surface.
 *
 * Three reads: what was sent, what may ever be sent, and how much has been
 * sent. All of them are administration -- the send history names which patients
 * the clinic contacted and when, which is health-adjacent whatever the message
 * said, so it is not a general staff view.
 *
 * There is no send endpoint here, and there must not be. Every message leaves
 * through Notifier, from a closed template catalogue, because a free-text send
 * API is a free-text disclosure API: SMS transits the mobile operator and lands
 * on a lock screen anyone nearby can read.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
class NotificationController extends Controller
{
    public function __construct(protected TemplateRegistry $templates) {}

    /**
     * What the clinic actually sent.
     *
     * The question behind this endpoint is "was the patient told?", which
     * arrives after a missed appointment, an uncollected order or a complaint.
     */
    public function index(IndexNotificationRequest $request): AnonymousResourceCollection
    {
        $this->authoriseAdministrator($request->user());

        $query = OutboundNotification::query();

        $status = $request->status();

        if ($status instanceof NotificationStatus) {
            $query->where('status', $status);
        }

        $channel = $request->channel();

        if ($channel instanceof NotificationChannel) {
            $query->where('channel', $channel);
        }

        $templateKey = $request->templateKey();

        if ($templateKey !== null) {
            $query->where('template_key', $templateKey);
        }

        $this->betweenDays($query, $request->from(), $request->to());

        $notifications = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage());

        return OutboundNotificationResource::collection($notifications);
    }

    /**
     * The catalogue: every message this platform is capable of sending.
     *
     * Returned in full, patterns included, because the clinic is the data
     * controller and is entitled to see exactly what is sent under its own
     * sender ID. It is also the review surface for the content rule -- the
     * catalogue is short enough to read, which is the only reason the rule can
     * be checked at all.
     *
     * The catalogue is READ-ONLY. A clinic cannot edit a pattern or add one:
     * every template is asserted against the prohibited-content list, and an
     * editable template is an unreviewed one.
     */
    public function templates(Request $request): JsonResponse
    {
        $this->authoriseAdministrator($request->user());

        $catalogue = array_map(
            fn (NotificationTemplate $template): array => [
                'key' => $template->key,
                'body' => $template->pattern,
                'placeholders' => $template->placeholders(),
                'channels' => array_map(
                    fn (NotificationChannel $channel): string => $channel->value,
                    $template->channels,
                ),
                // A permanent failure on one of these is surfaced to staff
                // rather than swallowed.
                'is_critical' => $template->isCritical,
                'permits_link' => $template->permitsLink,
            ],
            array_values($this->templates->all()),
        );

        return new JsonResponse([
            'data' => $catalogue,
            'meta' => [
                'total' => count($catalogue),
                'note' => 'SMS is not a confidential channel: assume the operator reads every '
                    .'message and that it lands on a lock screen. Every template states only '
                    .'that something is ready and where to sign in; what it concerns is shown '
                    .'in-app, under authentication, and nowhere else.',
            ],
        ]);
    }

    /**
     * SMS consumption for the current month.
     *
     * COUNTS OF MESSAGES, not a stored figure. SMS is a metered pass-through
     * billed by the gateway at cost plus a small margin; this platform holds
     * nothing on the clinic's behalf and keeps no ledger to draw down, so the
     * only honest report is what it can count: the messages recorded for this
     * clinic, and how many the per-tenant rate limit suppressed.
     *
     * The suppressed count is the operationally important one. A clinic seeing
     * it rise is a clinic whose reminders are silently not arriving.
     */
    public function smsBalance(Request $request): JsonResponse
    {
        $this->authoriseAdministrator($request->user());

        $periodStart = CarbonImmutable::now($this->timezone($request))->startOfMonth();

        $counts = [];

        foreach (NotificationStatus::cases() as $status) {
            $counts[$status->value] = OutboundNotification::query()
                ->where('created_at', '>=', $periodStart)
                ->where('status', $status)
                ->count();
        }

        $suppressed = OutboundNotification::query()
            ->where('created_at', '>=', $periodStart)
            ->where('failure_reason', 'rate_limited')
            ->count();

        return new JsonResponse([
            'data' => [
                'period_start' => $periodStart->toDateString(),
                'sms' => $counts + ['total' => array_sum($counts)],
                'rate_limit' => [
                    'per_minute' => Notifier::MAX_PER_TENANT_PER_MINUTE,
                    'suppressed_this_period' => $suppressed,
                ],
            ],
            'meta' => [
                'note' => 'These are the messages recorded for this clinic. SMS is metered and '
                    .'invoiced by the gateway; no credit is held on the clinic\'s behalf, so no '
                    .'figure here is a claim about what the gateway will charge.',
            ],
        ]);
    }

    /**
     * @param  Builder<OutboundNotification>  $query
     */
    private function betweenDays(Builder $query, ?CarbonImmutable $from, ?CarbonImmutable $to): void
    {
        if ($from !== null) {
            $query->where('created_at', '>=', $from);
        }

        if ($to !== null) {
            $query->where('created_at', '<=', $to);
        }
    }

    private function timezone(Request $request): string
    {
        $tenant = $request->attributes->get('tenant');

        if (! $tenant instanceof Tenant) {
            return 'Africa/Kampala';
        }

        $timezone = $tenant->getAttribute('timezone');

        return is_string($timezone) && $timezone !== '' ? $timezone : 'Africa/Kampala';
    }

    /**
     * Only the clinic administrator, and only an active one.
     *
     * The send history names which patients were contacted, and the catalogue
     * is the clinic's own configuration surface. Both sit under Administration
     * in the RBAC matrix, where every row is administrator-only.
     *
     * Checked inline rather than through a policy: OutboundNotification has no
     * user-initiated write, so a policy on it would describe abilities that do
     * not exist.
     *
     * @see docs/50-security-compliance/rbac-matrix.md -- Administration
     *
     * @throws AuthorizationException
     */
    private function authoriseAdministrator(mixed $user): void
    {
        if ($user instanceof User && $user->is_active && $user->hasRole(ClinicalRole::ClinicAdmin->value)) {
            return;
        }

        throw new AuthorizationException('Only a clinic administrator may read the notification log.');
    }
}
