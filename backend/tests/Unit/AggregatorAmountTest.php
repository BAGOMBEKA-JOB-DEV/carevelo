<?php

use App\Services\Payments\AggregatorPayload;
use App\Services\Payments\AggregatorUnavailable;
use App\Support\Currency;
use App\Support\Money;

/*
|--------------------------------------------------------------------------
| Money across the aggregator boundary
|--------------------------------------------------------------------------
|
| The single most dangerous line of arithmetic in this system. Money is stored
| as {amount_minor, currency} where a minor unit is ONE HUNDREDTH OF A SHILLING
| — which is not obvious, because Currency::UGX::hasSubunitInPractice() is false
| and nobody in Uganda quotes cents. The factor comes from MoneyCast, which
| stores `amount_minor` beside a currency, and from Money::ugx(), which
| multiplies whole shillings by a hundred.
|
| Aggregators speak MAJOR units. So every collection crosses a factor of one
| hundred on the way out and again on the way back, and the two conversions must
| be exact inverses.
|
| Why a wrong factor is not caught downstream: the fraud boundary compares what
| the aggregator REPORTED against what we STORED. Submit a hundred times the fee
| and the aggregator dutifully reports back a hundred times the fee — which
| agrees with nothing, so it is refused, and the patient has already paid. Get it
| wrong the other way and the clinic collects thirty shillings for a thirty
| thousand shilling consultation. Neither failure is visible in a code review;
| both are visible here.
|
| See docs/70-decisions/0003-non-custodial-payment-architecture.md
|
*/

it('converts a realistic UGX consultation fee exactly', function () {
    // PaymentIntentFactory's amount, and a real Kampala private-clinic
    // consultation: UGX 30,000. Written three ways so the relationship between
    // them is the assertion rather than a comment.
    $fee = Money::ugx(30_000);

    expect($fee->amountMinor)->toBe(3_000_000)
        ->and($fee->format())->toBe('UGX 30,000')
        ->and(AggregatorPayload::majorUnits($fee->amountMinor))->toBe('30000.00');
});

it('is the exact inverse of the inbound conversion, for every amount', function (int $amountMinor) {
    // The property, not an example. minorUnits() is the conversion the
    // Flutterwave webhook and the Pesapal status read already use for money
    // arriving; majorUnits() is the same arithmetic pointed the other way, and
    // a round trip that loses a shilling loses it for someone.
    $major = AggregatorPayload::majorUnits($amountMinor);

    expect(AggregatorPayload::minorUnits($major))->toBe($amountMinor);
})->with([
    'zero' => 0,
    'one hundredth of a shilling' => 1,
    'one shilling' => 100,
    'a consultation' => 3_000_000,
    'a dispensed course' => 1_150_000,
    'an inpatient bill' => 245_000_000,
    'awkward, and not a round shilling' => 3_000_037,
    // Larger than any single Ugandan mobile-money transaction, and comfortably
    // inside a 64-bit integer. Included because the conversion must not start
    // rounding at scale — which is exactly what a float would do here.
    'absurd' => 999_999_999_999,
]);

it('never produces a float on the way out', function () {
    // The whole point. `3_000_037 / 100` is an IEEE-754 double, and a double is
    // what Money exists to keep out of a money path; sprintf on a double would
    // then be rounding, not formatting. intdiv() and % cannot produce one.
    expect(AggregatorPayload::majorUnits(3_000_037))->toBeString()->toBe('30000.37');
});

it('keeps the hundredths, rather than quietly dropping them', function () {
    // A sub-shilling amount cannot be collected in practice — UGX has no
    // subunit anybody uses — but silently truncating one would be the system
    // deciding, on its own, to collect a different amount than it recorded.
    expect(AggregatorPayload::majorUnits(99))->toBe('0.99')
        ->and(AggregatorPayload::majorUnits(1))->toBe('0.01');
});

it('refuses a negative amount instead of inverting it', function () {
    // A negative collection is not a reversal. Reversals arrive as a STATUS,
    // never as a sign — the inbound side already refuses one, and initiating a
    // negative collection would be an instruction to pay a patient, which is
    // custody by another name.
    expect(fn () => AggregatorPayload::majorUnits(-3_000_000))
        ->toThrow(AggregatorUnavailable::class, 'negative amount');
});

it('states the currency it is converting for, and there is only one', function () {
    // If a second currency is ever added, this test is the reminder that the
    // factor of one hundred above is a property of the STORAGE format rather
    // than of the shilling, and that a zero-decimal currency would need its own
    // conversion rather than this one.
    expect(Currency::cases())->toHaveCount(1)
        ->and(Currency::UGX->hasSubunitInPractice())->toBeFalse();
});
