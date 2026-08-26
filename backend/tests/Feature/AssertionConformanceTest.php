<?php

use PHPUnit\Framework\ExpectationFailedException;

/*
|--------------------------------------------------------------------------
| Assertion conformance -- assertions that assert nothing
|--------------------------------------------------------------------------
|
| A test that passes for the wrong reason is worse than no test, because it is
| counted. This file exists because the codebase had thirty-eight of them, all
| written in the same shape, and every single one was a clinical-content,
| patient-name or credential-leak control -- the payload sweep over every
| broadcast event, "never writes note text into the audit log", the rider
| data-minimisation check, the Pesapal and platform-billing credential checks
| and the LiveKit API-secret checks. They were green from the day they were
| written and they asserted nothing at all.
|
| THE MECHANISM, because it is not obvious and it will be rediscovered.
|
| Pest's toContain() is VARIADIC -- vendor/pestphp/pest/src/Mixins/Expectation.php
| declares `toContain(mixed ...$needles)` and loops, asserting each needle is
| present. It takes no `$message`. Almost every other expectation in Pest DOES
| take `string $message = ''` as a trailing argument, so passing one reads as
| completely ordinary and the types still check.
|
| `not` is OppositeExpectation, which implements every negation by running the
| POSITIVE expectation and catching ExpectationFailedException. So
|
|     expect($haystack)->not->toContain($term, "… leaked '{$term}'");
|
| asks "does the haystack contain BOTH the term AND that sentence?", and negates
| the whole conjunction. The sentence is never in the haystack, so the
| conjunction always failed, so the negation always passed -- whether or not the
| leak was there. Demonstrated below rather than described, because that is the
| only form of this claim a reviewer should accept.
|
| The house form is str_contains() plus toBeFalse(), which takes a real
| `string $message` and so loses nothing:
|
|     expect(str_contains($haystack, $term))->toBeFalse("… leaked '{$term}'");
|
| This is the same failure mode as the audit comment-stripper regex the repo
| already carries a scar from: green, and inert. The remedy is the same one --
| stop trusting that the shape is right and make a test say so.
|
| See docs/80-quality/test-strategy.md
|
*/

/**
 * Every `->not->toContain(...)` / `->not->toContainEqual(...)` call in the test
 * suite that was handed more than one argument.
 *
 * Read with PHP's own tokeniser rather than a regular expression, deliberately.
 * The prose above and the comments on the repaired sites both contain the
 * broken form written out as an example, and a grep-based check would flag its
 * own documentation -- which is how a rule like this gets an exemption list and
 * then gets ignored. token_get_all() hands back comments and doc comments as
 * their own token types, so the scan below sees only code, and the explanation
 * of the trap can be written as plainly as it needs to be.
 *
 * @return list<string>
 */
function inertContainmentAssertions(): array
{
    $offences = [];

    /** @var iterable<string, SplFileInfo> $files */
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__.'/..'));

    foreach ($files as $path => $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }

        $tokens = array_values(array_filter(
            token_get_all((string) file_get_contents($path)),
            // Whitespace and comments are dropped so that a call split across
            // several lines reads the same as one written on a single line.
            fn (array|string $token): bool => is_string($token)
                || ! in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
        ));

        foreach ($tokens as $i => $token) {
            if (! isInertContainmentCall($tokens, $i)) {
                continue;
            }

            $line = is_array($token) ? $token[2] : 0;
            $offences[] = str_replace(base_path().'/', '', (string) $path).':'.$line;
        }
    }

    sort($offences);

    return $offences;
}

/**
 * Whether the token at $i opens `->not->toContain(` with a comma at depth zero
 * inside its argument list.
 *
 * A single-needle negation is correct and stays. Two or more arguments is the
 * defect, and it is a defect either way round: a genuine second needle is also
 * wrong, because `not` negates the CONJUNCTION -- "does not contain both" is
 * satisfied by containing one of them, which is never what anybody meant.
 *
 * @param  list<array{0: int, 1: string, 2: int}|string>  $tokens
 */
function isInertContainmentCall(array $tokens, int $i): bool
{
    $shape = [
        [T_OBJECT_OPERATOR, '->'],
        [T_STRING, 'not'],
        [T_OBJECT_OPERATOR, '->'],
        [T_STRING, null],
    ];

    foreach ($shape as $offset => [$type, $text]) {
        $token = $tokens[$i + $offset] ?? null;

        if (! is_array($token) || $token[0] !== $type) {
            return false;
        }

        if ($text !== null && $token[1] !== $text) {
            return false;
        }
    }

    /** @var array{0: int, 1: string, 2: int} $method */
    $method = $tokens[$i + 3];

    if (! in_array($method[1], ['toContain', 'toContainEqual'], true)) {
        return false;
    }

    if (($tokens[$i + 4] ?? null) !== '(') {
        return false;
    }

    return hasTopLevelComma($tokens, $i + 4);
}

/**
 * @param  list<array{0: int, 1: string, 2: int}|string>  $tokens
 * @param  int  $open  index of the '(' that opens the argument list
 */
function hasTopLevelComma(array $tokens, int $open): bool
{
    $depth = 0;

    for ($i = $open; $i < count($tokens); $i++) {
        $token = $tokens[$i];

        if (! is_string($token)) {
            continue;
        }

        if (in_array($token, ['(', '[', '{'], true)) {
            $depth++;
        } elseif (in_array($token, [')', ']', '}'], true)) {
            $depth--;

            if ($depth === 0) {
                return false;
            }
        } elseif ($token === ',' && $depth === 1) {
            return true;
        }
    }

    return false;
}

it('demonstrates that a negated containment assertion given a message asserts nothing', function () {
    $haystack = 'suspected pulmonary tuberculosis';

    // THE BROKEN FORM DOES NOT THROW, even though the haystack plainly contains
    // the term the assertion claims to forbid. This is the whole defect, made
    // executable: every repaired site in this suite was exactly this call with
    // a real payload substituted for the string above.
    //
    // Should Pest ever give toContain() a $message parameter, this expectation
    // is the thing that fails, and the scan below can then be deleted rather
    // than quietly kept for a reason nobody remembers.
    //
    // `not` is held in a variable rather than chained, and that is not a style
    // choice. This is the one place in the suite that must EXECUTE the broken
    // call, and the sweep below is a syntactic scan for `->not->toContain(`.
    // Written as a chain, this line would be a genuine offence in the scanner's
    // eyes and the only available remedy would be an exemption list keyed on
    // this filename -- and a rule with an exemption list is a rule on its way to
    // being ignored. Splitting the chain is the same call at runtime,
    // OppositeExpectation and all, with nothing suppressed.
    $negated = expect($haystack)->not;

    expect(fn () => $negated->toContain('tuberculosis', "leaked 'tuberculosis'"))
        ->not->toThrow(ExpectationFailedException::class);

    // The house form catches it, and still carries the sentence a failing test
    // needs to be actionable -- toBeFalse() takes a real string $message.
    expect(fn () => expect(str_contains($haystack, 'tuberculosis'))->toBeFalse("leaked 'tuberculosis'"))
        ->toThrow(ExpectationFailedException::class);
});

it('has no assertion in the suite that passes a message to a negated containment check', function () {
    // An empty list, not a count: a failure has to name the file and line, or
    // the person who trips it has to re-derive this whole investigation.
    expect(inertContainmentAssertions())->toBe([]);
});

/**
 * PHP source tokenised the way the sweep above tokenises it: whitespace and
 * comments dropped, keys renumbered so the shape match can index forward.
 *
 * @return list<array{0: int, 1: string, 2: int}|string>
 */
function strippedTokens(string $source): array
{
    return array_values(array_filter(
        token_get_all($source),
        fn (array|string $token): bool => is_string($token)
            || ! in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
    ));
}

/** Whether the sweep's shape match fires anywhere in a snippet of PHP source. */
function findsInertCall(string $source): bool
{
    $tokens = strippedTokens($source);

    foreach (array_keys($tokens) as $i) {
        if (isInertContainmentCall($tokens, $i)) {
            return true;
        }
    }

    return false;
}

it('detects the broken form when it is present', function () {
    // The scanner is itself a test control, so it gets the same treatment
    // everything else in this file gets: proof that it fails when it should.
    // The sources below are strings rather than a fixture file, because a
    // fixture file inside tests/ would be found by the sweep above and fail it.
    expect(findsInertCall('<?php expect($body)->not->toContain($term, "leaked");'))
        ->toBeTrue('the scanner missed a real offence')
        ->and(findsInertCall('<?php expect($body)->not->toContain($term);'))
        ->toBeFalse('the scanner flagged a correct single-needle negation');
});
