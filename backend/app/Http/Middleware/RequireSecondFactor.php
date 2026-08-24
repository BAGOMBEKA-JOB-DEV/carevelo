<?php

namespace App\Http\Middleware;

use App\Http\Responses\ProblemDetails;
use App\Models\User;
use App\Support\Totp\SecondFactorSession;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The gate that makes acceptance criterion 5 true rather than claimed.
 *
 * docs/40-api/authentication-and-sessions.md, § Acceptance criteria, item 5:
 * "Platform operators cannot authenticate without a second factor." Not
 * "are prompted for", not "are expected to hold" -- cannot. That is a statement
 * about what a session can REACH, and the only place it can be enforced as one is
 * in front of every route the session might reach.
 *
 * ============================================================
 * WHY THIS SITS ON THE WHOLE GROUP AND NOT ON EACH ROUTE
 * ============================================================
 *
 * The platform group is the cross-tenant control surface: the tenant register,
 * provisioning, suspension, the controller-obligation export, and break-glass --
 * which is the only route by which anybody at Carevelo reaches a clinic's
 * clinical records. A per-route middleware list is a list somebody has to
 * remember to add to, and the failure mode of forgetting is a new cross-tenant
 * endpoint reachable with one factor. Nothing about that failure is visible: the
 * endpoint works, the tests pass, and the control is simply absent from one door.
 *
 * So it is applied to the group, once, and a route is exempt only by being named
 * in PERMITTED_ROUTES below.
 *
 * ============================================================
 * IT IS DELIBERATELY THE SECOND LOCK ON THE SAME DOOR
 * ============================================================
 *
 * PlatformAuthController does not log anybody in until a code has been accepted
 * -- see SecondFactorSession for why the password step issues no session at all
 * -- so in the flow as it stands today this middleware refuses nothing. That is
 * the point of it. It holds if a later change introduces any OTHER way for a
 * platform account to acquire a session: an impersonation tool, a support
 * "sign in as", a console command, a test helper that reaches for actingAs(). Any
 * of those would silently satisfy `auth:sanctum` and would still be refused here,
 * because the stamp this reads is written in exactly one place: the challenge
 * endpoint, after a code verified.
 *
 * ============================================================
 * TENANT ACCOUNTS PASS, AND THAT IS NOT AN OVERSIGHT
 * ============================================================
 *
 * A `clinic_admin` legitimately reaches ONE route in this group: the break-glass
 * register, narrowed by BreakGlassGrantPolicy to grants against their own clinic.
 * The clinic is the data controller and has a right to know when its processor
 * read its records, so refusing them here would remove a documented right in the
 * name of a control the same document makes MANDATORY for platform operators and
 * merely RECOMMENDED for them.
 *
 * The honest position, stated rather than dressed up: the recommended second
 * factor for `clinic_admin` is not built. There is no enrolment path on the
 * tenant surface and no challenge step in the tenant sign-in, so no tenant
 * account can be enrolled and a check here would be a check that never fires.
 * When that surface is built, the condition to add is in one place -- this
 * method -- and the tenant sign-in must grow the challenge step in the same
 * change, or a clinic_admin who enrols locks themselves out of their own
 * register.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/50-security-compliance/threat-model.md § Spoofing
 */
class RequireSecondFactor
{
    /**
     * The routes an authenticated-but-unverified session may still reach.
     *
     * Sign-out, and nothing else. A person who cannot proceed must still be able
     * to leave -- on a shared machine the alternative is walking away from a
     * half-open session -- and signing out reduces what the session can do rather
     * than extending it.
     *
     * NOTHING ELSE IS ON THIS LIST, on purpose. RequirePasswordChange permits
     * `GET /v1/me` so a client can explain the wall it hit; the equivalent here
     * would hand an account's name, email address and platform roles to whoever
     * holds the password alone, and the sign-in response already tells the client
     * everything it needs to render the code step: that a code is needed.
     *
     * The challenge endpoint itself is absent because it is not behind
     * `auth:sanctum` at all -- there is no session to authenticate at that point.
     *
     * @var list<string>
     */
    public const PERMITTED_ROUTES = [
        'api.v1.platform.auth.sign-out',
    ];

    public function __construct(private readonly SecondFactorSession $secondFactor) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // Not authenticated, or authenticated as something that is not one of our
        // accounts. `auth:sanctum` answers that with a 401; this middleware has no
        // opinion and must not turn a 401 into a 403.
        if (! $user instanceof User) {
            return $next($request);
        }

        if ($request->routeIs(...self::PERMITTED_ROUTES)) {
            return $next($request);
        }

        if ($this->secondFactor->hasVerified($request, $user)) {
            return $next($request);
        }

        if (! $user->isPlatformUser()) {
            // See the class docblock: a clinic administrator reading the grants
            // against their own clinic.
            return $next($request);
        }

        // 403 rather than 401. The session is genuinely authenticated; what is
        // missing is a factor, and answering 401 would send a client back to a
        // password form it has already completed. `code` is what a client keys on
        // to show the code step; `detail` is what an operator reads if it does not.
        return ProblemDetails::make(
            403,
            'second_factor_required',
            'This session has not completed a second factor',
            'A platform operator signs in with a password and then a code from their '
            .'authenticator. Sign in again and complete both steps.',
        );
    }
}
