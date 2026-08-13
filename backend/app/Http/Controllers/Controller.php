<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;

/**
 * Laravel 13's base controller is deliberately empty. AuthorizesRequests is
 * added here because every endpoint in this API authorises explicitly:
 * policies are default-deny, and $this->authorize() is how a controller
 * consults them.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
abstract class Controller
{
    use AuthorizesRequests;
}
