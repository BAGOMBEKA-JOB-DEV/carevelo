<?php

namespace App\Console\Commands;

use App\Console\Contracts\RunsOnDemand;
use App\Models\OutboundNotification;
use App\Models\Tenant;
use App\Support\PhoneNumber;
use App\Tenancy\Tenancy;
use Illuminate\Console\Command;

/**
 * Reads the one-time code out of the message that would have gone by SMS.
 *
 * Local development has no SMS gateway, so a code is queued and never delivered. This
 * reads it from the notification the Notifier wrote — the same place the acceptance
 * test reads it, and deliberately not from otp_codes, which stores only a digest.
 *
 * LOCAL ONLY, refused elsewhere. It prints a live credential: a command that hands out
 * sign-in codes must not be one `--env` flag away from doing so on a real clinic.
 *
 * The plaintext exists in the message body and nowhere else, which is a property worth
 * noticing rather than working around.
 */
class DevShowOtpCommand extends Command implements RunsOnDemand
{
    /** @var string */
    protected $signature = 'dev:otp {phone : The number the code was sent to} {--tenant= : Subdomain, defaults to the only clinic}';

    /** @var string */
    protected $description = 'Show the latest one-time code for a phone number (local only)';

    public function whyNotScheduled(): string
    {
        return 'A developer convenience for local sign-in. It prints a live credential, '
            .'so it is invoked by hand and refuses to run outside the local environment.';
    }

    public function handle(Tenancy $tenancy): int
    {
        if (! app()->environment('local')) {
            $this->components->error('dev:otp is local-only. It prints a live sign-in credential.');

            return self::FAILURE;
        }

        $subdomain = $this->option('tenant');

        $tenant = is_string($subdomain) && $subdomain !== ''
            ? Tenant::query()->firstWhere('subdomain', $subdomain)
            : Tenant::query()->first();

        if ($tenant === null) {
            $this->components->error('No clinic found. Seed one: php artisan db:seed --class=DemoClinicSeeder');

            return self::FAILURE;
        }

        $phone = PhoneNumber::tryParse((string) $this->argument('phone'));

        if ($phone === null) {
            $this->components->error('That is not a phone number this system would have stored.');

            return self::FAILURE;
        }

        $code = $tenancy->run($tenant->id, function () use ($phone): ?string {
            $message = OutboundNotification::query()
                ->where('recipient', (string) $phone)
                ->latest()
                ->first();

            if ($message === null) {
                return null;
            }

            preg_match('/\b(\d{6})\b/', (string) $message->body, $matches);

            return $matches[1] ?? null;
        });

        if ($code === null) {
            $this->components->warn(sprintf(
                'No code for %s at %s. Request one first: POST /api/v1/auth/otp/request',
                $phone,
                $tenant->subdomain,
            ));

            return self::FAILURE;
        }

        $this->components->info(sprintf('Code for %s: %s', $phone, $code));

        return self::SUCCESS;
    }
}
