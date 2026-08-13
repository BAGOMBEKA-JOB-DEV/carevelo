<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\Notifications\NotificationChannel;
use App\Support\Notifications\NotificationStatus;
use App\Support\PhoneNumber;
use Database\Factories\OutboundNotificationFactory;
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
class OutboundNotification extends Model
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
