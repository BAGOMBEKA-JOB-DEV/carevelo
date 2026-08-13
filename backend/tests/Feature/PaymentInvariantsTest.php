<?php

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Tenancy\Tenancy;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Date;

/*
|--------------------------------------------------------------------------
| Payment invariants
|--------------------------------------------------------------------------
|
| Carevelo never takes custody of patient funds. Payment is initiated against
| the CLINIC'S OWN merchant account at a BoU-licensed aggregator, using the
| clinic's own credentials, and settles directly to the clinic.
|
| See docs/50-security-compliance/payments-regulatory-boundary.md
|
*/

function inPaymentTenant(callable $callback): mixed
{
    return app(Tenancy::class)->run(Tenant::factory()->create()->id, $callback);
}

it('treats a timeout as recoverable, not final', function () {
    // THE critical payment rule. Mobile-money confirmations arrive late, and
    // treating a timeout as definitive failure produces the worst outcome
    // available: a patient charged for a booking that was cancelled.
    inPaymentTenant(function () {
        $intent = PaymentIntent::factory()->timedOut()->create();

        expect($intent->status->canTransitionTo(PaymentIntentStatus::Succeeded))->toBeTrue();

        $intent->markSucceeded('FLW-REF-123');

        expect($intent->status)->toBe(PaymentIntentStatus::Succeeded)
            ->and($intent->aggregator_reference)->toBe('FLW-REF-123')
            ->and($intent->next_poll_at)->toBeNull();
    });
});

it('refuses an illegal payment transition', function () {
    inPaymentTenant(function () {
        // A failed payment is terminal; it cannot silently become successful.
        $intent = PaymentIntent::factory()->create(['status' => PaymentIntentStatus::Failed]);
        $intent->markSucceeded();
    });
})->throws(IllegalTransition::class);

it('validates a callback amount against the stored intent', function () {
    // NEVER trust the amount in a callback. Accepting it would let a forged or
    // replayed payload confirm a large booking against a small payment.
    inPaymentTenant(function () {
        $intent = PaymentIntent::factory()->create(['amount_minor' => 3_000_000]);

        expect($intent->amountMatches(3_000_000))->toBeTrue()
            ->and($intent->amountMatches(100))->toBeFalse();
    });
});

it('enforces idempotency key uniqueness within a tenant', function () {
    // Prevents a retried request becoming a second charge.
    inPaymentTenant(function () {
        PaymentIntent::factory()->create(['idempotency_key' => 'key-abc']);
        PaymentIntent::factory()->create(['idempotency_key' => 'key-abc']);
    });
})->throws(QueryException::class);

it('allows the same idempotency key in a different tenant', function () {
    // Scoped per tenant, not globally: one clinic's key must not collide with
    // another's.
    $tenancy = app(Tenancy::class);
    $a = Tenant::factory()->create();
    $b = Tenant::factory()->create();

    $tenancy->run($a->id, fn () => PaymentIntent::factory()->create(['idempotency_key' => 'shared']));
    $second = $tenancy->run($b->id, fn () => PaymentIntent::factory()->create(['idempotency_key' => 'shared']));

    expect($second->idempotency_key)->toBe('shared');
});

it('schedules polls on a graduated schedule', function () {
    // A webhook is never the only path to resolution: missed webhooks are
    // ordinary in this market, and an intent stuck pending forever is a
    // patient who does not know whether they paid.
    Date::setTestNow('2026-08-13 12:00:00');

    inPaymentTenant(function () {
        $intent = PaymentIntent::factory()->create(['initiated_at' => Date::now()]);

        // Under two minutes old: poll every minute.
        $intent->scheduleNextPoll();
        expect(Date::now()->diffInSeconds($intent->next_poll_at))->toBe(60.0)
            ->and($intent->poll_attempts)->toBe(1);
    });
});

it('cannot refund, because it holds nothing to refund from', function () {
    $intent = new PaymentIntent;

    expect(fn () => $intent->refund())
        ->toThrow(IllegalTransition::class, 'never takes custody');
});

it('surfaces the aggregator failure message verbatim', function () {
    // Only the aggregator knows why a mobile-money collection failed, and
    // paraphrasing loses the part the patient can act on.
    inPaymentTenant(function () {
        $intent = PaymentIntent::factory()->create();
        $intent->markFailed('INSUFFICIENT_FUNDS', 'The subscriber has insufficient balance.');

        expect($intent->failure_message)->toBe('The subscriber has insufficient balance.')
            ->and($intent->status)->toBe(PaymentIntentStatus::Failed);
    });
});

it('keeps one tenant payment records invisible to another', function () {
    $tenancy = app(Tenancy::class);
    $a = Tenant::factory()->create();
    $b = Tenant::factory()->create();

    $tenancy->run($a->id, fn () => PaymentIntent::factory()->create());

    expect($tenancy->run($b->id, fn () => PaymentIntent::query()->count()))->toBe(0);
});
