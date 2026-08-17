<?php

namespace App\Support\Auth;

use App\Models\User;
use Illuminate\Auth\AuthManager;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Contracts\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Opens, closes and revokes sessions.
 *
 * Sessions are Sanctum cookie sessions on the `web` guard: HTTP-only,
 * SameSite=Lax, Secure. Not bearer tokens in local storage -- a token there is
 * readable by any script that gets a foothold, and on a page rendering
 * special-category health data that is not a trade worth making for a
 * convenience the first-party clients do not need.
 *
 * A session is bound to exactly one tenant, resolved at sign-in and checked
 * against the request host on every subsequent request by ResolveTenant. There
 * is no tenant switching: somebody working at two clinics signs out and in.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class SessionRegistry
{
    public function __construct(
        protected AuthManager $auth,
        protected DatabaseManager $db,
        protected Repository $config,
    ) {}

    /**
     * Sign the user in.
     *
     * The identifier is regenerated immediately: a session id that existed
     * before authentication must not survive it, or an attacker who planted one
     * on a shared clinic terminal inherits the session the next person opens.
     */
    public function start(Request $request, User $user): void
    {
        // `auth:sanctum` leaves the sanctum guard as the default one, holding a
        // resolved "nobody" from before this request authenticated. Dropping the
        // resolved guards makes the new session visible to every reader of
        // $request->user() rather than only to the `web` guard.
        $this->auth->forgetGuards();

        $this->guard()->login($user);

        if ($request->hasSession()) {
            $request->session()->regenerate();
        }
    }

    public function end(Request $request): void
    {
        $this->guard()->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        // Same reason in reverse: the sanctum guard caches the user it resolved
        // at the start of this request, and would keep answering with them.
        $this->auth->forgetGuards();
    }

    /**
     * Revoke every session for this user except the one making the request.
     *
     * Called on password change. The person changing a password is frequently
     * doing it BECAUSE they believe someone else is signed in as them -- on a
     * clinic terminal left logged in, or a handset that changed hands -- and a
     * password change that leaves those sessions alive does nothing about the
     * thing that prompted it.
     *
     * The remember token is rotated alongside this by the caller, which is what
     * kills any long-lived "remember me" cookie the same attacker might hold.
     *
     * @param  ?string  $keepSessionId  null when the request has no session of its own, in which case every session goes
     * @return int sessions revoked
     */
    public function purgeOtherSessions(User $user, ?string $keepSessionId): int
    {
        if ($this->config->get('session.driver') !== 'database') {
            // Nothing to revoke server-side: file and cookie sessions have no
            // index by user. The rotated remember token still applies.
            return 0;
        }

        $connection = $this->config->get('session.connection');

        $query = $this->db->connection(is_string($connection) ? $connection : null)
            ->table((string) $this->config->get('session.table', 'sessions'))
            ->where('user_id', $user->getKey());

        if ($keepSessionId !== null) {
            $query->where('id', '!=', $keepSessionId);
        }

        return $query->delete();
    }

    /**
     * A fresh remember token, invalidating every remember-me cookie in issue.
     *
     * Not saved here -- the caller is already writing the user row, and two
     * writes would be two audit-relevant updates for one action.
     */
    public function rotateRememberToken(User $user): void
    {
        $user->setRememberToken(Str::random(60));
    }

    protected function guard(): StatefulGuard
    {
        /** @var StatefulGuard $guard */
        $guard = $this->auth->guard('web');

        return $guard;
    }
}
