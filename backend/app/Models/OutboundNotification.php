<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Contracts\RestrictableToPatient;
use App\Support\Notifications\NotificationChannel;
use App\Support\Notifications\NotificationStatus;
use App\Support\PhoneNumber;
use Database\Factories\OutboundNotificationFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * One message sent, or attempted, on an untrusted channel.
 *
 * The row exists so a clinic can answer "was the patient told?" -- which is a
 * question that arrives after a missed appointment, an unpaid order, or a
 * complaint. Status, timestamps and the template used; nothing about why.
 *
 * CARRIES NO CLINICAL DATA. `body` is rendered from the closed template
 * catalogue, every interpolated value is checked against the prohibited-content
 * list, and the catalogue itself is asserted against that list by test. The
 * body is stored rather than re-derived because what was actually sent is the
 * fact in dispute, not what a template would produce today.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property NotificationChannel $channel
 * @property string $recipient
 * @property string $template_key
 * @property string $body
 * @property NotificationStatus $status
 * @property ?Carbon $sent_at
 * @property ?Carbon $delivered_at
 * @property ?string $failure_reason
 */
class OutboundNotification extends Model implements RestrictableToPatient
{
    use BelongsToTenant;

    /** @use HasFactory<OutboundNotificationFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'channel', 'recipient', 'template_key', 'body',
        'status', 'sent_at', 'delivered_at', 'failure_reason',
    ];

    /**
     * Why a send was abandoned. A closed list, because "SMS not received" is a
     * recurring support question and free text cannot be counted.
     */
    public const FAILURE_REASONS = [
        'gateway_unavailable',
        'rejected_by_gateway',
        'rate_limited',
        'invalid_recipient',
    ];

    /**
     * sent_at, delivered_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * The instant stored then depends on how the database server happens to be
     * configured. What shifts here is delivery evidence for a message a patient says never arrived.
     *
     * Columns declared without a timezone ignore the offset, so created_at and
     * updated_at are unaffected.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'channel' => NotificationChannel::class,
            'status' => NotificationStatus::class,
            'sent_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    /** The gateway accepted it. Not proof any handset received it. */
    /**
     * Narrow to notifications addressed to the patient records this account owns.
     *
     * Matched on the RECIPIENT NUMBER, because that is the only link there is: a
     * notification records a channel, a number and a body, and the Notifier is
     * handed an E.164 string rather than a patient. (tenant_id, phone) is unique
     * on patients, so within one clinic a number resolves to at most one record
     * and the mapping is unambiguous.
     *
     * Deliberately UNDER-inclusive. A notification sent to a guardian_phone that
     * differs from the record's own phone is not listed here. That withholds a
     * message the patient could arguably see, which is the right direction for the
     * mistake to run -- the alternative is showing one patient a message about
     * another.
     *
     * A subquery rather than a plucked list: phone is cast to PhoneNumber, and
     * comparing casts against a raw column invites a mismatch that would silently
     * return nothing.
     *
     * @param  Builder<covariant Model>  $query
     */
    public static function restrictToPatient(Builder $query, User $user): void
    {
        $query->whereIn('recipient', Patient::query()
            ->whereIn('id', $user->ownedPatientIds())
            ->select('phone'));
    }

    public function markSent(): void
    {
        $this->status = NotificationStatus::Sent;
        $this->sent_at = Date::now();
        $this->failure_reason = null;
        $this->save();
    }

    /** A delivery receipt came back, where the gateway provides them. */
    public function markDelivered(): void
    {
        $this->status = NotificationStatus::Delivered;
        $this->delivered_at = Date::now();
        $this->sent_at ??= Date::now();
        $this->save();
    }

    /**
     * Recorded only once the retries are exhausted.
     *
     * A transient gateway error mid-retry is not a failure yet, and marking it
     * as one would tell a clinic the patient was never told while the next
     * attempt is still pending.
     */
    public function markFailed(string $reason): void
    {
        $this->status = NotificationStatus::Failed;
        $this->failure_reason = in_array($reason, self::FAILURE_REASONS, true)
            ? $reason
            : 'gateway_unavailable';
        $this->save();
    }

    /**
     * The recipient, partially masked: 0772 *** 456.
     *
     * The only form permitted in a log line. A phone number identifies a
     * person, and "this person received a message from this clinic" is itself
     * a disclosure that they are a patient of it.
     */
    public function maskedRecipient(): string
    {
        return PhoneNumber::tryParse($this->recipient)?->masked() ?? 'unparseable';
    }
}
