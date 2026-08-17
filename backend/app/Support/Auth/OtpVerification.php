<?php

namespace App\Support\Auth;

use App\Models\OtpCode;

/**
 * The result of checking a submitted code.
 *
 * Carries the matched record where there was one, so the caller can name it in
 * the audit event by identifier. The code itself is never part of this object
 * and never leaves the request that generated it.
 */
final class OtpVerification
{
    public function __construct(
        public readonly OtpOutcome $outcome,
        public readonly ?OtpCode $code = null,
    ) {}

    public function succeeded(): bool
    {
        return $this->outcome === OtpOutcome::Verified;
    }
}
