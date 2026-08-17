<?php

use App\Support\Branding\BrandPalette;

/*
|--------------------------------------------------------------------------
| The WCAG AA guarantee, as a property rather than an example
|--------------------------------------------------------------------------
|
| white-labeling-and-branding.md acceptance criterion 3: "Foreground colours meet
| WCAG AA contrast regardless of the tenant's choice."
|
| That promise was FALSE until this file existed, and the reason it survived is
| instructive. Two tests asserted the mechanism on two example colours -- #1B7F5A
| resolving to white, #FFFEF0 resolving to dark -- and both examples sat outside the
| band where the bug lived. Pairing white with near-black (#111111) leaves ordinary
| colours where NEITHER option reaches 4.5:1: 9,217 of 262,144 sampled colours
| failed, the worst being #E43430, an unremarkable red, at 4.35:1. A clinic with a
| red logo shipped button text below AA.
|
| "Regardless of the tenant's choice" is a claim about every colour, so the test has
| to be about every colour. A unit test can sweep the space in a second; a feature
| test making HTTP requests could not, which is why this logic was extracted out of
| the resource in the first place.
|
| @see docs/10-product/white-labeling-and-branding.md
|
*/

/**
 * Every colour at a fixed step through the RGB cube.
 *
 * A 4-unit step is 262,144 colours -- fine enough to catch the failing band, which
 * spans far more than 4 units in every direction, and quick enough to belong in the
 * suite that runs on every commit rather than in a nightly job nobody reads.
 *
 * @return Generator<string>
 */
function everyColour(int $step = 4): Generator
{
    for ($r = 0; $r < 256; $r += $step) {
        for ($g = 0; $g < 256; $g += $step) {
            for ($b = 0; $b < 256; $b += $step) {
                yield sprintf('#%02X%02X%02X', $r, $g, $b);
            }
        }
    }
}

it('gives every possible clinic colour a foreground that meets WCAG AA', function () {
    // THE branding accessibility test. Not a sample: the promise is universal, so
    // the assertion is too.
    $worst = ['hex' => null, 'ratio' => INF];
    $failures = 0;
    $total = 0;

    foreach (everyColour() as $hex) {
        $total++;

        $foreground = BrandPalette::readableForeground($hex);
        $ratio = BrandPalette::contrastRatio($hex, (string) $foreground);

        if ($ratio < BrandPalette::AA_NORMAL_TEXT) {
            $failures++;

            if ($ratio < $worst['ratio']) {
                $worst = ['hex' => $hex, 'ratio' => $ratio];
            }
        }
    }

    expect($total)->toBeGreaterThan(250_000)
        ->and($failures)->toBe(0, sprintf(
            '%d of %d colours fall below AA 4.5:1. Worst: %s at %.3f:1. '
            .'The dark foreground option is not dark enough to pair with white.',
            $failures,
            $total,
            (string) $worst['hex'],
            $worst['ratio'],
        ));
});

it('reproduces the specific colour that used to fail', function () {
    // #E43430 was the worst case under the old #111111 pairing, at 4.346:1. Named
    // explicitly so that if anyone lightens the dark ink again, the failure points
    // straight at the reason rather than at a statistic.
    $foreground = BrandPalette::readableForeground('#E43430');

    expect(BrandPalette::contrastRatio('#E43430', (string) $foreground))
        ->toBeGreaterThanOrEqual(BrandPalette::AA_NORMAL_TEXT);
});

it('matches the reference luminance values in the WCAG definition', function () {
    // The maths itself, checked against known values. Without this, the sweep above
    // could pass with a subtly wrong formula.
    expect(BrandPalette::relativeLuminance('#000000'))->toBe(0.0)
        ->and(BrandPalette::relativeLuminance('#FFFFFF'))->toBe(1.0)
        ->and(round(BrandPalette::contrastRatio('#000000', '#FFFFFF'), 2))->toBe(21.0);
});

// --- Resolution ------------------------------------------------------------

it('rejects anything that is not a six-digit hex triplet', function (mixed $hostile) {
    // Belt and braces over entry validation. Each of these is an attempt to escape
    // the token and reach a stylesheet, a URL or a script context.
    $palette = BrandPalette::from($hostile, $hostile);

    expect($palette->primary)->toBeNull()
        ->and($palette->primaryForeground)->toBeNull()
        ->and($palette->surface)->toBeNull();
})->with([
    // Named rows, so a failure says which hostile input got through rather than
    // printing a truncated value. Each inner array is ONE row carrying ONE
    // argument -- Pest spreads a row across parameters, so a bare ['#FF0000']
    // would arrive as the perfectly valid string '#FF0000' and the test would be
    // asserting nothing.
    'colour keyword' => ['red'],
    'rgb function' => ['rgb(255,0,0)'],
    'shorthand hex' => ['#FFF'],
    'non-hex digits' => ['#GGGGGG'],
    'style escape' => ['#FF0000;}</style><script>alert(1)</script>'],
    'url function' => ['url(https://evil.test/x.png)'],
    'var reference' => ['var(--something-else)'],
    'important flag' => ['#FF0000 !important'],
    // PHP's `$` matches before a trailing newline unless the D modifier is set.
    'trailing newline' => ["#FF0000\n"],
    'newline then script' => ["#FF0000\n<script>alert(1)</script>"],
    'empty string' => [''],
    'null' => [null],
    'integer' => [123456],
    'array' => [['#FF0000']],
]);

it('derives a surface that stays a background rather than becoming a colour', function () {
    // Text sits on this using the ordinary ink tokens, so a tint drifting towards
    // mid-strength would quietly reduce the contrast of everything on top of it.
    foreach (['#1B7F5A', '#E43430', '#0F3D2E', '#445CAB'] as $brand) {
        $surface = (string) BrandPalette::surfaceFrom($brand);

        expect(BrandPalette::contrastRatio($surface, '#000000'))
            ->toBeGreaterThan(BrandPalette::AA_NORMAL_TEXT, "surface for {$brand} is too dark for dark ink");
    }
});

it('exposes the full token set the client applies', function () {
    $tokens = BrandPalette::from('#1B7F5A', '#0F3D2E')->toTokens();

    expect(array_keys($tokens))->toBe([
        'primary_colour',
        'primary_foreground',
        'secondary_colour',
        'secondary_foreground',
        'surface',
    ]);
});

// --- Advisories ------------------------------------------------------------

it('advises on a colour too pale to carry the brand, without refusing it', function () {
    $palette = BrandPalette::from('#FFFEF0', null);

    expect($palette->primary)->toBe('#FFFEF0')
        ->and($palette->primaryForeground)->toBe('#000000')
        ->and($palette->advisories())->not->toBeEmpty();
});

it('advises when the two brand colours are hard to tell apart', function () {
    expect(BrandPalette::from('#1B7F5A', '#1C805B')->advisories())->not->toBeEmpty();
});

it('says nothing about a pair that works', function () {
    // Both constraints have to hold at once and they pull against each other: each
    // colour needs >= 3:1 against white (so neither is pale), while the two need
    // >= 4.5:1 between them (so they are told apart). That forces one deep and one
    // mid-tone. Deep navy with a mid green: 15.54 and 3.38 against white, 4.59
    // between.
    //
    // Worth recording what does NOT qualify, because both were my first guesses:
    // #1B7F5A with #0F3D2E is two greens only 2.45:1 apart, and #F4C542 is a gold
    // at 1.63:1 against white. The advisory is right to fire on both.
    expect(BrandPalette::from('#0A2540', '#2E9E68')->advisories())->toBeEmpty();
});
