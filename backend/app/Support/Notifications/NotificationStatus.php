<?php

namespace App\Support\Notifications;

/**
 * The lifecycle of one outbound message.
 *
 * `sent` means the gateway accepted it, which is NOT the same as the handset
 * receiving it — that is `delivered`, and only where the gateway reports
 * receipts. The distinction matters when a patient says they were never told.
 */
enum NotificationStatus: string
{
    case Queued = 'queued';
    case Sent = 'sent';
    case Delivered = 'delivered';
    case Failed = 'failed';

    /** Whether the gateway has already accepted this message. */
    public function isHandedOver(): bool
    {
        return $this === self::Sent || $this === self::Delivered;
    }

    /** Whether there is nothing further for the queue to attempt. */
    public function isResolved(): bool
    {
        return $this !== self::Queued;
    }
}
