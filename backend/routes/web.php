<?php

/*
|--------------------------------------------------------------------------
| Web routes
|--------------------------------------------------------------------------
|
| Deliberately empty. This application serves an API and nothing else: every
| product surface -- the clinic console, the patient app and the rider view --
| lives in the separate frontend/ tree and reaches this one over HTTP only.
| See docs/70-decisions/0007-separate-backend-frontend-trees.md
|
| `laravel new` scaffolds a root route rendering resources/views/welcome.blade.php.
| Both are removed. A Blade view here is the first step towards rendering product
| UI from the backend, which is the boundary ADR-0007 exists to hold, and CI fails
| the build if one reappears.
|
| The file itself stays because bootstrap/app.php references it, and because an
| empty routes file states the intent more clearly than a missing one. Health
| checks are registered separately: /up by the framework, /health/* in api.php.
|
*/
