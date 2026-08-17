<?php

namespace App\Support\Auth;

/**
 * What a one-time code may be used for.
 *
 * A closed list, and deliberately a short one. A code issued to prove control
 * of a handset at sign-in must not be replayable against some other operation,
 * so every purpose that ever exists is named here and matched exactly at
 * verification.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
enum OtpPurpose: string
{
    case SignIn = 'sign_in';
}
