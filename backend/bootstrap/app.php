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

        $exceptions->render(function (AuthorizationException $e, Request $request) {
            if (! $request->is('api/*')) {
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
