<?php

namespace Tests;

use App\Models\User;
use App\Support\Totp\SecondFactorSession;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Sign in as a platform operator who has ALREADY passed the second factor.
     *
     * WHY THIS EXISTS RATHER THAN `actingAs()`. Every route in the platform group
     * runs behind `RequireSecondFactor`, because
     * docs/40-api/authentication-and-sessions.md testable rule 5 says a platform
     * operator cannot authenticate without one. `actingAs()` establishes an
     * identity and nothing else, so under that middleware it produces a session
     * that has passed a password and no challenge -- which is exactly the state
     * the middleware exists to refuse, and every call answers 403.
     *
     * That is the middleware working. The tests that hit 403 were written before
     * a second factor existed, and the fix is to give them the stamp a real
     * operator holds after the challenge, NOT to exempt their routes.
     *
     * The stamp is minted by `SecondFactorSession::verifiedState()` -- the same
     * function the challenge endpoint writes on success -- so a test cannot drift
     * from what production puts in the session.
     *
     * DO NOT REACH FOR THIS TO MAKE A REFUSAL TEST PASS. A test proving that a
     * clinic user or a rider cannot reach a platform route must keep using plain
     * `actingAs()`: it should be refused for lacking the ROLE, and handing it a
     * second-factor stamp is what keeps that assertion about the thing it names.
     */
    protected function actingAsOperator(User $operator): static
    {
        return $this->actingAs($operator)
            ->withSession(SecondFactorSession::verifiedState($operator));
    }
}
