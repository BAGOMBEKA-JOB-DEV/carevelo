<?php

use App\Support\PhoneNumber;

it('normalises every way Ugandans write the same number', function (string $raw) {
    // All six of these are the same number. Normalising once at the boundary
    // removes an entire class of duplicate-account bugs and makes
    // (tenant_id, phone) a usable uniqueness constraint.
    expect(PhoneNumber::parse($raw)->e164)->toBe('+256772123456');
})->with([
    '0772123456',
    '+256772123456',
    '256772123456',
    '0772 123 456',
    '+256 772 123456',
    '(+256) 772-123-456',
]);

it('accepts landlines as well as mobiles', function () {
    expect(PhoneNumber::parse('0312345678')->isMobile())->toBeFalse()
        ->and(PhoneNumber::parse('0772123456')->isMobile())->toBeTrue();
});

it('rejects numbers that are not Ugandan', function (string $raw) {
    expect(PhoneNumber::tryParse($raw))->toBeNull();
})->with([
    '077212345',        // too short
    '07721234567',      // too long
    '+447700900000',    // UK
    '0912345678',       // invalid prefix
    'not a phone',
    '',
]);

it('formats for local display', function () {
    expect(PhoneNumber::parse('+256772123456')->formatNational())->toBe('0772 123 456');
});

it('masks for support tooling', function () {
    // Support should be able to confirm a number without reading all of it.
    expect(PhoneNumber::parse('+256772123456')->masked())->toBe('0772 *** 456');
});

it('compares by normalised value', function () {
    expect(PhoneNumber::parse('0772123456')->equals(PhoneNumber::parse('+256 772 123 456')))
        ->toBeTrue();
});
