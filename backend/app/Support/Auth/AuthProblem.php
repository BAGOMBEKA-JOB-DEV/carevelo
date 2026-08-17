<?php

namespace App\Support\Auth;

use App\Http\Responses\ProblemDetails;
use Illuminate\Http\JsonResponse;

/**
 * The refusals shared by every authentication endpoint.
 *
 * Shared so the endpoints cannot drift apart. A 429 that differed between them
 * would tell an attacker which endpoint had engaged its limiter, and therefore
 * which of their inputs was worth repeating.
 *
 * @see docs/40-api/api-conventions.md
 */
final class AuthProblem
{
    public static function throttled(int $retryAfterSeconds): JsonResponse
    {
        return ProblemDetails::make(
            429,
            'too_many_attempts',
            'Too many attempts',
            'Wait a few minutes and try again.',
        )->header('Retry-After', (string) $retryAfterSeconds);
    }

    /**
     * The clinic's account is suspended and this is a member of its staff.
     *
     * Said plainly, because by this point the caller has proved who they are and
     * somebody at the clinic needs to know why nobody can work. Patients never
     * reach here: suspension is a commercial action and must never become a
     * clinical one.
     */
    public static function suspended(): JsonResponse
    {
        return ProblemDetails::make(
            403,
            'tenant_suspended',
            'This clinic account is suspended',
            'Staff sign-in is unavailable until the clinic account is reactivated.',
        );
    }
}
