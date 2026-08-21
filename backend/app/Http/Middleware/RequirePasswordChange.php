<?php

namespace App\Http\Middleware;

use App\Http\Responses\ProblemDetails;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Holds an account that did not choose its own password to one act: choosing one.
 *
 * This closes a real privilege escalation rather than tidying a workflow. Clinic
 * staff create patient accounts and read the initial password aloud, so for as
 * long as it stands a second person knows it. The RBAC matrix gives consent
 * grant and withdrawal to the `patient` role and to NOBODY else -- every staff
 * column is a dash. A member of staff who signs in with the credential they
 * issued can therefore forge a consent decision, and the audit trail will record
 * the actor as the patient, because as far as every layer of the system is
 * concerned the patient is who signed in. Advising a password change does not
 * close that; only refusing to act until it happens does.
 *
 * SIGN-IN ITSELF STILL SUCCEEDS. The session has to exist before the password
 * can be changed, so the gate is here and not in AuthController: a refusal at
 * sign-in would leave the patient holding a credential and no way to spend it.
 *
 * THE ALLOW-LIST IS WHERE THIS BREAKS THE PRODUCT. One wrong route name and a
 * patient signs in, can do nothing at all, for ever, with no way out and no error
 * that explains it. So the names below are asserted to be registered routes by
 * the test suite, and the gate is exercised over real HTTP rather than by calling
 * the middleware directly.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class RequirePasswordChange
{
    /**
     * Everything an account in this state may still do.
     *
     * Read who you are, so the client can tell the patient WHY it is showing
     * them a password form. Replace the password, which is the only way out.
     * Sign out, because a person who cannot proceed must still be able to leave
     * -- especially on a shared clinic terminal, where the alternative is walking
     * away from somebody else's session.
     *
     * @var list<string>
     */
    public const PERMITTED_ROUTES = [
        'api.v1.me',
        'api.v1.me.password',
        'api.v1.auth.sign-out',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User || ! $user->mustChangePassword()) {
            return $next($request);
        }

        if ($request->routeIs(...self::PERMITTED_ROUTES)) {
            return $next($request);
        }

        // 403 and not 401: the session is genuinely authenticated and re-signing
        // in would change nothing. The code is what a client keys on to send the
        // patient to the password form; the title is what a patient reads if it
        // does not.
        return ProblemDetails::make(
            403,
            'password_change_required',
            'Choose your own password to continue',
            'This account was opened for you at the clinic with a password somebody else '
            .'chose. Set your own, and everything else opens up.',
        );
    }
}
