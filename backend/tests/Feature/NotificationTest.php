<?php

use App\Jobs\SendNotificationJob;
use App\Jobs\TenantAwareJob;
use App\Models\AuditEvent;
use App\Models\OutboundNotification;
use App\Models\Patient;
use App\Models\Tenant;
use App\Support\Notifications\GatewayUnavailable;
use App\Support\Notifications\NotificationChannel;
use App\Support\Notifications\NotificationStatus;
use App\Support\Notifications\NotificationTemplate;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\ProhibitedContent;
use App\Support\Notifications\ProhibitedNotificationContent;
use App\Support\Notifications\SmsGateway;
use App\Support\Notifications\TemplateRegistry;
use App\Tenancy\Tenancy;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| Notifications -- the content rule
|--------------------------------------------------------------------------
|
| SMS is not a confidential channel. A message transits the mobile operator,
| lands on a lock screen anyone standing nearby can read, and sits in a shared
| handset's inbox indefinitely. Health data is special-category under DPPA 2019,
| and that includes the mere fact that someone is a patient of a named clinic.
|
| So the acceptance criteria in the notifications document are tested here as
| invariants of the catalogue rather than of any one message: no template may
| carry clinical content, every template must identify the clinic, an OTP may
| never carry a link, and sending may never fail the work that triggered it.
|
| See docs/10-product/notifications-sms-whatsapp.md
|
*/

/**
 * Realistic, deliberately unremarkable values for every placeholder.
 *
 * A template is only as clean as what gets interpolated into it, so the review
 * test renders each one rather than reading the pattern alone.
 *
 * @return array<string, string|int>
 */
function benignParameters(NotificationTemplate $template): array
{
    $values = [];

    foreach ($template->placeholders() as $name) {
        $values[$name] = match (true) {
            $name === 'clinic' => 'Kira Family Clinic',
            $name === 'clinic_phone' => '0772 123 456',
            $name === 'code' => '482913',
            $name === 'expires_in_minutes' => 5,
            $name === 'starts_at' => 'Monday 17 August at 10:00',
            $name === 'amount', $name === 'total' => 'UGX 45,000',
            $name === 'reference' => 'RX-2608-0042',
            str_contains($name, 'link') => 'https://kira.carevelo.ug/s/ab12cd',
            default => 'AB12CD',
        };
    }

    return $values;
}

/** A gateway that is always down. */
function explodingGateway(): SmsGateway
{
    return new class extends SmsGateway
    {
        public function send(OutboundNotification $notification): void
        {
            throw new GatewayUnavailable('The gateway is not answering.');
        }
    };
}

/*
|--------------------------------------------------------------------------
| Acceptance criterion 1 -- no clinical content in any template
|--------------------------------------------------------------------------
*/

it('has no prohibited term in any template in the catalogue', function () {
    $violations = [];

    foreach (app(TemplateRegistry::class)->all() as $key => $template) {
        // The pattern, and the message a patient actually receives. The pattern
        // alone would miss a placeholder name that is itself a disclosure.
        foreach ([$template->pattern, $template->render(benignParameters($template))] as $text) {
            if (! ProhibitedContent::isClean($text)) {
                // The term is deliberately not repeated into the failure
                // message: it is the thing that must not be written down.
                $violations[] = $key;
            }
        }
    }

    expect(array_unique($violations))->toBeEmpty(
        'No notification may contain a diagnosis, a medicine name, a test result or a '
        .'reason for the appointment. Offending templates: '.implode(', ', array_unique($violations))
    );
});

it('refuses a parameter that carries clinical content', function () {
    // The realistic failure is not a bad template -- those are reviewed here --
    // but a caller helpfully interpolating what the message is about.
    $template = app(TemplateRegistry::class)->get(TemplateRegistry::ORDER_READY_FOR_PICKUP);

    expect(fn () => $template->render([
        'clinic' => 'Kira Family Clinic',
        'reference' => 'Amoxicillin 500mg x 21',
    ]))->toThrow(ProhibitedNotificationContent::class);
});

it('detects a prohibited term wherever it appears', function () {
    // Guards the guard. A tripwire nobody has tested is decoration.
    expect(ProhibitedContent::firstMatch('Your prescription for Amoxicillin is ready'))->toBe('amoxicillin')
        ->and(ProhibitedContent::firstMatch('Your malaria test is POSITIVE'))->not->toBeNull()
        ->and(ProhibitedContent::firstMatch('Your antenatal appointment is confirmed'))->not->toBeNull()
        ->and(ProhibitedContent::firstMatch('Your prescription from Kira Family Clinic is ready.'))->toBeNull();
});

/*
|--------------------------------------------------------------------------
| Acceptance criterion 2 -- every template identifies the clinic
|--------------------------------------------------------------------------
*/

it('identifies the clinic as sender in every template', function () {
    foreach (app(TemplateRegistry::class)->all() as $template) {
        expect($template->pattern)->toContain('{clinic}')
            ->and($template->render(benignParameters($template)))->toContain('Kira Family Clinic');
    }
});

it('cannot register a template that does not name the clinic', function () {
    new NotificationTemplate(key: 'test.anonymous', pattern: 'Your results are ready.');
})->throws(InvalidArgumentException::class, 'does not identify the clinic');

it('takes the clinic name from the tenant and not from the caller', function () {
    Queue::fake();

    $tenant = Tenant::factory()->create(['trading_name' => 'Kira Family Clinic']);

    app(Tenancy::class)->run($tenant->id, function () {
        $notification = app(Notifier::class)->send(
            TemplateRegistry::PRESCRIPTION_READY,
            '0772123456',
            // A caller cannot send under someone else's brand, deliberately or
            // by copying a parameter array from another call site.
            ['clinic' => 'Some Other Clinic', 'sign_in_link' => 'https://kira.carevelo.ug/s/ab12cd'],
        );

        expect($notification->body)->toContain('Kira Family Clinic')
            ->and($notification->body)->not->toContain('Some Other Clinic');
    });
});

/*
|--------------------------------------------------------------------------
| Acceptance criterion 4 -- an OTP carries no link
|--------------------------------------------------------------------------
*/

it('never puts a link in an OTP', function () {
    $template = app(TemplateRegistry::class)->get(TemplateRegistry::REGISTRATION_OTP);

    $body = $template->render(benignParameters($template));

    expect($template->permitsLink)->toBeFalse()
        ->and($body)->not->toContain('http')
        ->and($body)->not->toContain('www.')
        ->and($body)->not->toContain('://')
        ->and($body)->toContain('482913');
});

it('cannot register a link-free template that contains a link', function () {
    // A code and a link in one SMS is the shape of every mobile-money phishing
    // message in this market. Ours must never look the same.
    new NotificationTemplate(
        key: 'test.otp',
        pattern: '{clinic}: your code is {code}. Confirm at https://example.ug/verify',
        permitsLink: false,
    );
})->throws(InvalidArgumentException::class, 'link-free');

/*
|--------------------------------------------------------------------------
| Acceptance criterion 5 -- WhatsApp is never the sole channel
|--------------------------------------------------------------------------
*/

it('offers SMS on every template', function () {
    foreach (app(TemplateRegistry::class)->all() as $key => $template) {
        expect($template->supports(NotificationChannel::Sms))
            ->toBeTrue("Template [{$key}] would be unreachable without a data connection.");
    }
});

it('cannot register a WhatsApp-only template', function () {
    new NotificationTemplate(
        key: 'test.whatsapp_only',
        pattern: 'Your appointment with {clinic} is confirmed.',
        channels: [NotificationChannel::WhatsApp],
    );
})->throws(InvalidArgumentException::class, 'never the sole channel');

it('adds WhatsApp alongside SMS when the patient has opted in', function () {
    Queue::fake();

    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        app(Notifier::class)->send(
            TemplateRegistry::APPOINTMENT_CONFIRMED,
            '0772123456',
            ['starts_at' => 'Monday at 10:00', 'join_link' => 'https://kira.carevelo.ug/c/ab12cd'],
            alsoOnWhatsApp: true,
        );

        $channels = OutboundNotification::query()->get()
            ->map(fn (OutboundNotification $notification) => $notification->channel->value)
            ->all();

        expect($channels)->toContain(NotificationChannel::Sms->value)
            ->and($channels)->toContain(NotificationChannel::WhatsApp->value);
    });
});

/*
|--------------------------------------------------------------------------
| Acceptance criterion 3 -- sending is asynchronous
|--------------------------------------------------------------------------
*/

it('queues the send instead of reaching the gateway inline', function () {
    // The queue is faked rather than run: the sync driver would execute the job
    // in the caller's stack, which is precisely the coupling under test. In
    // production a worker picks it up.
    Queue::fake();
    app()->instance(SmsGateway::class, explodingGateway());

    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        $notification = app(Notifier::class)->send(
            TemplateRegistry::PRESCRIPTION_READY,
            '0772123456',
            ['sign_in_link' => 'https://kira.carevelo.ug/s/ab12cd'],
        );

        expect($notification->status)->toBe(NotificationStatus::Queued)
            ->and($notification->sent_at)->toBeNull();
    });

    Queue::assertPushed(SendNotificationJob::class);
});

it('cannot fail the transaction that triggered it', function () {
    // An SMS gateway timeout must never fail a booking. The gateway here is
    // dead; the patient must still be registered when send() returns.
    Queue::fake();
    app()->instance(SmsGateway::class, explodingGateway());

    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, function () {
        $patient = DB::transaction(function () {
            $patient = Patient::factory()->create();

            app(Notifier::class)->send(
                TemplateRegistry::PRESCRIPTION_READY,
                '0772123456',
                ['sign_in_link' => 'https://kira.carevelo.ug/s/ab12cd'],
            );

            return $patient;
        });

        expect(Patient::query()->whereKey($patient->id)->exists())->toBeTrue()
            ->and(OutboundNotification::query()->count())->toBe(1);
    });
});

it('puts the OTP on the high priority queue', function () {
    Queue::fake();

    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, fn () => app(Notifier::class)->send(
        TemplateRegistry::REGISTRATION_OTP,
        '0772123456',
        ['code' => '482913', 'expires_in_minutes' => 5],
    ));

    Queue::assertPushedOn('high', SendNotificationJob::class);
});

/*
|--------------------------------------------------------------------------
| Acceptance criteria 7 and 8 -- tenant context, and failures reaching staff
|--------------------------------------------------------------------------
*/

it('restores tenant context before it sends', function () {
    $tenant = Tenant::factory()->create();

    $job = app(Tenancy::class)->run(
        $tenant->id,
        fn () => new SendNotificationJob(OutboundNotification::factory()->create()->id)
    );

    expect($job)->toBeInstanceOf(TenantAwareJob::class)
        ->and($job->tenantId)->toBe($tenant->id)
        ->and($job->tags())->toContain('tenant:'.$tenant->id);
});

it('records the send with identifiers only', function () {
    $tenant = Tenant::factory()->create();
    $tenancy = app(Tenancy::class);

    $job = $tenancy->run($tenant->id, fn () => new SendNotificationJob(
        OutboundNotification::factory()->create()->id
    ));

    // Runs outside tenant context, exactly as a worker would.
    $job->handle();

    $tenancy->run($tenant->id, function () {
        $notification = OutboundNotification::query()->firstOrFail();

        expect($notification->status)->toBe(NotificationStatus::Sent)
            ->and($notification->sent_at)->not->toBeNull();

        $event = AuditEvent::query()->where('action', 'notification.sent')->firstOrFail();
        $metadata = $event->metadata ?? [];

        expect($metadata)->toHaveKey('template_key')
            // Never the body, never the number. That someone was told is
            // auditable; what they were told is not.
            ->and($metadata)->not->toHaveKey('body')
            ->and($metadata)->not->toHaveKey('recipient')
            ->and(json_encode($metadata))->not->toContain($notification->recipient);
    });
});

it('surfaces a critical notification that could not be sent', function () {
    $tenant = Tenant::factory()->create();
    $tenancy = app(Tenancy::class);

    $job = $tenancy->run($tenant->id, fn () => new SendNotificationJob(
        OutboundNotification::factory()->create()->id
    ));

    // What the worker calls once the three attempts are exhausted -- with no
    // tenant context, which is the interesting part.
    $job->failed(new GatewayUnavailable('The gateway is not answering.'));

    $tenancy->run($tenant->id, function () {
        $notification = OutboundNotification::query()->firstOrFail();

        expect($notification->status)->toBe(NotificationStatus::Failed)
            ->and($notification->failure_reason)->toBe('gateway_unavailable');

        $event = AuditEvent::query()->where('action', 'notification.failed')->firstOrFail();

        expect($event->metadata['critical'] ?? null)->toBeTrue();
    });
});

it('does not send the same notification twice', function () {
    // A duplicate SMS costs money and, on a shared handset, doubles the
    // disclosure surface. A retry after a successful send is a no-op.
    $tenant = Tenant::factory()->create();
    $tenancy = app(Tenancy::class);

    $job = $tenancy->run($tenant->id, fn () => new SendNotificationJob(
        OutboundNotification::factory()->sent()->create()->id
    ));

    $job->handle();

    $tenancy->run($tenant->id, function () {
        expect(AuditEvent::query()->where('action', 'notification.sent')->count())->toBe(0);
    });
});

/*
|--------------------------------------------------------------------------
| Acceptance criterion 6 -- per-tenant rate limits
|--------------------------------------------------------------------------
*/

it('suppresses ordinary messages once a tenant exceeds its minute allowance', function () {
    Queue::fake();

    $tenant = Tenant::factory()->create();
    $limiter = app(RateLimiter::class);

    for ($i = 0; $i < Notifier::MAX_PER_TENANT_PER_MINUTE; $i++) {
        $limiter->hit(Notifier::rateLimitKey($tenant->id), 60);
    }

    app(Tenancy::class)->run($tenant->id, function () {
        $notification = app(Notifier::class)->send(
            TemplateRegistry::APPOINTMENT_REMINDER,
            '0772123456',
            ['starts_at' => 'Monday at 10:00', 'join_link' => 'https://kira.carevelo.ug/c/ab12cd'],
        );

        expect($notification->status)->toBe(NotificationStatus::Failed)
            ->and($notification->failure_reason)->toBe('rate_limited');
    });

    Queue::assertNothingPushed();
});

it('never suppresses an OTP', function () {
    // Someone is looking at a sign-in screen. A tenant-wide reminder loop must
    // not lock a patient out of their own records.
    Queue::fake();

    $tenant = Tenant::factory()->create();
    $limiter = app(RateLimiter::class);

    for ($i = 0; $i < Notifier::MAX_PER_TENANT_PER_MINUTE; $i++) {
        $limiter->hit(Notifier::rateLimitKey($tenant->id), 60);
    }

    app(Tenancy::class)->run($tenant->id, function () {
        $notification = app(Notifier::class)->send(
            TemplateRegistry::REGISTRATION_OTP,
            '0772123456',
            ['code' => '482913', 'expires_in_minutes' => 5],
        );

        expect($notification->status)->toBe(NotificationStatus::Queued);
    });

    Queue::assertPushed(SendNotificationJob::class);
});

/*
|--------------------------------------------------------------------------
| Isolation
|--------------------------------------------------------------------------
*/

it('does not leak one clinic\'s send history to another', function () {
    // "This person received a message from this clinic" is itself a disclosure
    // that they are its patient -- special-category data under DPPA 2019.
    $tenancy = app(Tenancy::class);

    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $notification = $tenancy->run($tenantA->id, fn () => OutboundNotification::factory()->create());

    $tenancy->run($tenantB->id, function () use ($notification) {
        expect(OutboundNotification::find($notification->id))->toBeNull()
            ->and(OutboundNotification::withoutGlobalScopes()->find($notification->id))->toBeNull()
            // The query builder never consults an Eloquent scope. Only RLS
            // stops this one.
            ->and(DB::table('outbound_notifications')->where('id', $notification->id)->count())->toBe(0);
    });
});

it('has a template for every event in the notifications catalogue', function () {
    $registry = app(TemplateRegistry::class);

    $expected = [
        TemplateRegistry::REGISTRATION_OTP,
        TemplateRegistry::APPOINTMENT_CONFIRMED,
        TemplateRegistry::APPOINTMENT_REMINDER,
        TemplateRegistry::APPOINTMENT_CANCELLED,
        TemplateRegistry::PAYMENT_SUCCEEDED,
        TemplateRegistry::PAYMENT_FAILED,
        TemplateRegistry::PRESCRIPTION_READY,
        TemplateRegistry::ORDER_PRICED,
        TemplateRegistry::ORDER_READY_FOR_PICKUP,
        TemplateRegistry::DELIVERY_ON_ITS_WAY,
        TemplateRegistry::DELIVERY_COMPLETED,
        TemplateRegistry::RESULTS_AVAILABLE,
        TemplateRegistry::STAFF_INVITATION,
    ];

    foreach ($expected as $key) {
        expect($registry->has($key))->toBeTrue("The catalogue is missing [{$key}].");
    }

    // A template that is not in the document is a message nobody reviewed.
    expect(array_keys($registry->all()))->toEqualCanonicalizing($expected);
});

it('refuses to send a template that does not exist', function () {
    $tenant = Tenant::factory()->create();

    app(Tenancy::class)->run($tenant->id, fn () => app(Notifier::class)->send(
        'appointment.rescheduled_with_reason',
        '0772123456',
    ));
})->throws(InvalidArgumentException::class, 'No notification template');
