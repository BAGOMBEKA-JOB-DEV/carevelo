<?php

namespace App\Services\Payments;

use RuntimeException;

/**
 * The aggregator could not be reached, or answered with something unreadable.
 *
 * Never carries the response body or the request object. A clinic's merchant
 * credentials travel in the request headers, and an exception trace that holds
 * the request is precisely where they escape into a log file that outlives the
 * incident.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
class AggregatorUnavailable extends RuntimeException {}
