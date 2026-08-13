<?php

namespace App\Support\Notifications;

use RuntimeException;

/**
 * Raised when something clinical was about to be put on an untrusted channel.
 *
 * The message names WHERE the violation was found -- a template key, a
 * parameter name -- and never WHAT was found. The offending text is the very
 * thing that must not reach an error message, a log line or an exception
 * trace, and an exception exists to be logged.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
class ProhibitedNotificationContent extends RuntimeException
{
    public static function in(string $context): self
    {
        return new self(sprintf(
            'Refusing to send: %s carries clinical content. No notification may contain a '
            .'diagnosis, a medicine name, a test result or a reason for the appointment. '
            .'Say that something is ready and let the patient sign in to see it.',
            $context,
        ));
    }
}
