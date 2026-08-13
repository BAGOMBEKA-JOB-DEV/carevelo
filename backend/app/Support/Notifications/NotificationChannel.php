<?php

namespace App\Support\Notifications;

/**
 * The channels a notification may leave the platform on.
 *
 * Both are UNTRUSTED transports. SMS transits the mobile operator and lands on
 * a lock screen; WhatsApp Business API is hosted outside Uganda and so is a
 * cross-border transfer as well. Neither may ever carry clinical content.
 *
 * In-app is deliberately absent: it is not a notification channel, it is where
 * the clinical content actually lives, behind authentication.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
enum NotificationChannel: string
{
    case Sms = 'sms';
    case WhatsApp = 'whatsapp';

    /**
     * Whether the channel reaches a handset with no data connection.
     *
     * Only SMS does, which is why SMS is never optional and WhatsApp is never
     * the sole channel: a patient without data would simply never be told.
     */
    public function isUniversal(): bool
    {
        return $this === self::Sms;
    }
}
