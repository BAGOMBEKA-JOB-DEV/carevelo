<?php

use App\Exceptions\StateMachine\IllegalTransition;
use App\Exceptions\Tenancy\TenantContextMissing;
use App\Http\Middleware\BindTenantContext;
use App\Http\Middleware\ResolveTenant;
use App\Http\Responses\ProblemDetails;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Tenant resolution runs before the router dispatches, so no controller
        // can execute a query without row-level security scoped to a tenant.
        // Order matters: resolve, then bind to the database session.
        //
        // @see docs/30-architecture/multi-tenancy.md
        // PREPEND, not append.
        //
        // Route model binding (SubstituteBindings) runs inside the api group.
        // If tenant resolution came after it, every bound model would be
        // fetched with no tenant context -- RLS would return nothing and every
        // route with a model parameter would 404.
        //
        // Tenancy must be established before anything touches the database.

        $middleware->api(prepend: [
            ResolveTenant::class,
            BindTenantContext::class,
        ]);

        /*
         * Sanctum cookie sessions, which the architecture depends on and which were
         * not wired up at all.
         *
         * Without this the api group has no StartSession and no
         * EnsureFrontendRequestsAreStateful, so no session cookie is ever issued and
         * `auth:sanctum` falls through to bearer-token authentication, finds none, and
         * returns 401. Signing in appeared to work — verify returned 200 — and then
         * every authenticated request failed, which is a product that cannot be used
         * at all.
         *
         * It stayed invisible because Laravel's test client keeps the session in
         * process: RealSignInFlowTest asserts assertAuthenticatedAs and a subsequent
         * GET /v1/me, and both pass without a cookie ever crossing the wire. No test
         * asserted that a Set-Cookie header exists. SessionCookieTest does now.
         *
         * "All three surfaces use Sanctum cookie sessions — HTTP-only, Secure,
         * SameSite. No bearer token is held in local storage, where any script with a
         * foothold could read it on a page rendering health data."
         *
         * @see docs/40-api/authentication-and-sessions.md
         */
        $middleware->statefulApi();

        /*
         * Never redirect an unauthenticated API request.
         *
         * Illuminate\Auth\Middleware\Authenticate redirects a guest to route('login')
         * unless the request expects JSON — and this application has no `login` route,
         * because it has no web UI. So any unauthenticated call that did not send
         * `Accept: application/json` -- a browser opening an API URL, a client that
         * forgot the header -- got "Route [login] not defined" and a 500 instead of the
         * 401 the API contract promises.
         *
         * Returning null makes it throw AuthenticationException, which the handler below
         * renders as RFC 9457 problem details.
         */
        $middleware->redirectGuestsTo(fn (Request $request) => $request->is('api/*') ? null : '/');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // RFC 9457 problem details for every API error.
        // @see docs/40-api/api-conventions.md
        $exceptions->render(function (ValidationException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ProblemDetails::make(
                422,
                'validation_failed',
                'The request is invalid',
                errors: $e->errors(),
            );
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ProblemDetails::make(401, 'unauthenticated', 'Sign in to continue');
        });

        /*
         * 403, and WHY THIS IS NOT TYPED `AuthorizationException` ALONE.
         *
         * It was, and it never fired once. Not for a policy denial, not for a
         * `$this->authorize()` failure, not anywhere in the product. Every 403 that
         * arrived here as an exception answered with a bare `{"message": "This action
         * is unauthorized."}` -- the documented contract broken on the single most
         * security-relevant status code we serve.
         *
         * It hid well. The only 403s that looked right were the ones that never came
         * through this callback at all: RequireSecondFactor and AuthProblem::suspended()
         * RETURN a ProblemDetails response rather than throwing, so `second_factor_required`
         * and `tenant_suspended` were correct all along and made the 403 path look
         * healthy. And every denial test in the suite passed throughout, because
         * `assertForbidden()` reads the status line and nothing else.
         *
         * The cause is ordering inside the framework's handler. `Handler::render()`
         * calls `prepareException()` BEFORE `renderViaCallbacks()`, and
         * `prepareException()` rewrites the exception:
         *
         *     AuthorizationException without a status -> AccessDeniedHttpException
         *     AuthorizationException with a status    -> HttpException($e->status())
         *
         * So by the time the render callbacks are consulted, no `AuthorizationException`
         * exists any more. A callback typed to it can only ever match nothing.
         *
         * READ THIS BEFORE ADDING ANOTHER EXCEPTION RENDERER. The same rewrite catches
         * ModelNotFoundException (-> NotFoundHttpException), TokenMismatchException
         * (-> HttpException 419) and several more. Type the callback to what
         * `prepareException()` LEAVES BEHIND, not to what your code threw, or you will
         * write a renderer that silently does nothing exactly like this one did.
         *
         * Hence `HttpException`, which covers both rewrites and additionally covers
         * the `abort(403)` ResolveTenant raises when a session belonging to one clinic
         * arrives on another clinic's host -- an authorisation refusal that reaches the
         * handler as a plain HttpException and was answering off-contract for the same
         * reason, without ever having been an AuthorizationException at all.
         *
         * `AuthorizationException` is kept in the union deliberately: it names the case
         * this callback is FOR, and it is the safety net if a future framework version
         * stops performing that rewrite.
         *
         * THE STATUS GUARD IS LOAD-BEARING, NOT DEFENSIVE TIDINESS. NotFoundHttpException
         * extends HttpException, and this callback is registered ABOVE the 404 one, so
         * without the guard every cross-tenant 404 in the product would be answered here
         * as a 403 -- which is precisely the information disclosure the 404-not-403 rule
         * exists to prevent. Returning null lets it fall through to the 404 callback.
         *
         * The body carries no `detail` and never `$e->getMessage()`. A 403 can arrive
         * here from any `abort(403)` anywhere, including places that are not
         * authorisation decisions and whose messages are written for us rather than for
         * the caller. Surfacing one would tell whoever tripped it which internal check
         * refused and, worse, sometimes what it was refusing access to. A 403 body says
         * what the reader can do about it and nothing else, which is why the title is a
         * constant and there is no detail to drift.
         */
        $exceptions->render(function (AuthorizationException|HttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            if ($e instanceof HttpException && $e->getStatusCode() !== 403) {
                return null;
            }

            return ProblemDetails::make(403, 'forbidden', 'You do not have permission to do that');
        });

        // A resource in another tenant returns 404, NOT 403.
        //
        // A 403 confirms the resource exists, which leaks that a given patient
        // or reference belongs to some other clinic. With RLS in place this
        // happens naturally -- the row simply is not there.
        $exceptions->render(function (ModelNotFoundException|NotFoundHttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ProblemDetails::make(404, 'not_found', 'Not found');
        });

        // Illegal state transitions and domain rule violations. These carry
        // messages written for the person who triggered them.
        $exceptions->render(function (IllegalTransition $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ProblemDetails::make(409, 'illegal_transition', $e->getMessage());
        });

        $exceptions->render(function (TenantContextMissing $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return ProblemDetails::make(400, 'no_tenant', 'No clinic resolved for this request');
        });
    })->create();
