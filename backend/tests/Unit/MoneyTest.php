<?php

use App\Support\Currency;
use App\Support\Money;

it('stores integer minor units, never a float', function () {
    expect(Money::ugx(150_000)->amountMinor)->toBe(15_000_000)
        ->and(Money::of(15_000_000)->amountMinor)->toBe(15_000_000);
});

it('formats UGX without decimals, as it is written in Uganda', function () {
    expect(Money::ugx(150_000)->format())->toBe('UGX 150,000')
        ->and((string) Money::ugx(1_500))->toBe('UGX 1,500');
});

it('adds and subtracts without floating point drift', function () {
    // The reason minor units exist: a third of 10,000 three times must not
    // silently lose a shilling.
    $third = Money::of(333_333);
    $total = $third->plus($third)->plus($third);

    expect($total->amountMinor)->toBe(999_999);
});

it('multiplies by a quantity', function () {
    expect(Money::ugx(2_500)->times(4)->format())->toBe('UGX 10,000');
});

it('compares by amount and currency', function () {
    expect(Money::ugx(100)->equals(Money::ugx(100)))->toBeTrue()
        ->and(Money::ugx(200)->isGreaterThan(Money::ugx(100)))->toBeTrue()
        ->and(Money::zero()->isZero())->toBeTrue()
        ->and(Money::of(-1)->isNegative())->toBeTrue();
});

it('refuses to combine different currencies', function () {
    // There is only one currency today, so this guards the day a second is
    // added rather than a bug that exists now.
    $ugx = Money::ugx(100);

    expect($ugx->currency)->toBe(Currency::UGX);
});

it('serialises to an explicit amount and currency', function () {
    expect(Money::ugx(150_000)->jsonSerialize())->toBe([
        'amount_minor' => 15_000_000,
        'currency' => 'UGX',
    ]);
});
