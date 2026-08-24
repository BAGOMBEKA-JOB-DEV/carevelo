<?php

namespace App\Console\Commands;

use App\Console\Contracts\RunsOnDemand;
use App\Support\Auth\PlatformAccounts;
use App\Support\Totp\Totp;
use App\Support\Totp\TotpAuthenticator;
use Illuminate\Console\Command;

/**
 * Enrols a platform operator's authenticator from the shell.
 *
 * ============================================================
 * WHY THIS IS A COMMAND AND NOT AN ENDPOINT
 * ============================================================
 *
 * There are exactly two cases the product has for enrolling a second factor
 * without an existing one, and both of them are bootstrap problems:
 *
 *   - THE FIRST platform operator, who cannot enrol through an endpoint that is
 *     itself behind an already-enrolled session; and
 *   - an operator who has LOST their authenticator, which
 *     docs/40-api/authentication-and-sessions.md § Second factor says is
 *     "recovered out of band, as a recorded administrative action rather than by
 *     a message to a handset".
 *
 * Neither may be an HTTP route. An endpoint that enrols an authenticator with a
 * password alone is a password-only path to a second factor -- post a password,
 * enrol your own app, pass the challenge you just created -- which is precisely
 * the hole the whole surface exists to close, and it would close nothing while
 * looking compliant.
 *
 * Whoever runs this already has shell access to the application. They can read
 * APP_KEY, they can open a database session, they can edit the code. This hands
 * them nothing they did not already have, which is the test a bootstrap path has
 * to pass. TotpEnrolmentController is for ROTATION by an operator who has
 * already proved a factor in the current session.
 *
 * ============================================================
 * AND WHY THERE IS NO PHONE NUMBER ANYWHERE IN IT
 * ============================================================
 *
 * The account is named by EMAIL ADDRESS, because an email address and a password
 * is the whole of how a platform account signs in, and the enrolment URI this
 * prints is labelled with that same address. No code is sent anywhere. The
 * operator reads the URI or the secret off this terminal and puts it into an
 * authenticator app they control. App\Support\Totp\Totp::uri() sets out at
 * length why a second factor on this account must never touch a mobile network.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */
class EnrolPlatformSecondFactorCommand extends Command implements RunsOnDemand
{
    /** @var string */
    protected $signature = 'platform:enrol
        {email : The email address of the platform account}
        {--reason=bootstrap : Recorded in the audit event as how this enrolment was authorised}';

    /** @var string */
    protected $description = 'Enrol a TOTP authenticator for a platform operator (out-of-band, recorded)';

    public function whyNotScheduled(): string
    {
        return 'An out-of-band administrative act performed by a named human at a terminal: '
            .'the first platform operator, or one who has lost their authenticator. It prints '
            .'a live credential to the screen, which is not output a clock should ever produce.';
    }

    public function handle(PlatformAccounts $accounts, TotpAuthenticator $totp): int
    {
        $email = mb_strtolower(trim((string) $this->argument('email')));

        $user = $accounts->activeFor($email);

        if ($user === null) {
            /*
             * The same predicate the sign-in endpoint uses: no tenant, a
             * standing platform role, still active. Said plainly here, unlike
             * at the endpoint, because there is no enumeration surface at a
             * shell prompt -- the person running this can read the users table
             * directly -- and an operator debugging a failed bootstrap needs to
             * know WHICH of the three conditions failed.
             */
            $this->components->error(
                'No active platform account for that address. It needs tenant_id null and '
                .'either platform_support or platform_admin.'
            );

            return self::FAILURE;
        }

        if ($totp->isEnrolled($user) && ! $this->confirm(
            'That account already has a confirmed authenticator. Re-enrolling revokes it and '
            .'every recovery code it has. Continue?',
            false,
        )) {
            return self::FAILURE;
        }

        $enrolment = $totp->beginEnrolment($user, Totp::ISSUER);

        /*
         * Activated WITHOUT a challenge, and the method is named to be
         * uncomfortable for exactly that reason. Nothing here proves that the
         * operator's app holds the secret -- if they mistype it, they are
         * locked out and the recovery codes below are the way back. That is why
         * the codes are printed in the same breath and why the operator is told
         * to test the sign-in before closing the terminal.
         */
        $codes = $totp->activateWithoutChallenge($user, (string) $this->option('reason'));

        $this->newLine();
        $this->components->info('Second factor enrolled for '.$user->email);
        $this->newLine();

        /*
         * PRINTED, ONCE, TO A TERMINAL. This is the only moment any of these
         * values exists in the clear. None is stored unencrypted, none is
         * logged, and no audit event carries any of them -- the enrolment event
         * records that an enrolment happened, to which account, by what route,
         * and how many codes were issued.
         *
         * Which makes the shell history and the scrollback the exposure, and
         * saying so is the only mitigation a command has.
         */
        $this->line('  Enrolment URI (scan this):');
        $this->line('    '.$enrolment->uri);
        $this->newLine();
        $this->line('  Or type the secret in by hand:');
        $this->line('    '.$enrolment->secret);
        $this->newLine();
        $this->line('  Recovery codes -- each works once, and they are not recoverable:');

        foreach ($codes as $code) {
            $this->line('    '.$code);
        }

        $this->newLine();
        $this->components->warn(
            'Shown once. Nothing above is stored in a form anyone can read back, including us. '
            .'Test the sign-in before closing this terminal, then clear the scrollback.'
        );

        return self::SUCCESS;
    }
}
