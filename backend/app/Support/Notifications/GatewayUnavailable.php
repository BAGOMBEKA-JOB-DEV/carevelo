<?php

namespace App\Support\Notifications;

use RuntimeException;

/**
 * The SMS gateway could not be reached, or refused the message.
 *
 * Transient by assumption: the job retries. Only when the attempts are
 * exhausted does the notification become a failure a human has to look at.
 */
class GatewayUnavailable extends RuntimeException {}
