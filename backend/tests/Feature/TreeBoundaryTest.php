<?php

use Symfony\Component\Process\Process;

/*
|--------------------------------------------------------------------------
| Tree boundary
|--------------------------------------------------------------------------
|
| backend/ serves an API and nothing else. Every product surface lives in the
| separate frontend/ tree and reaches this one over HTTP.
|
| CI has enforced this since the beginning, but only as a shell step after the
| test suite -- so it went unexercised locally, and unreached on CI while earlier
| steps were failing. `laravel new`'s stock welcome.blade.php sat in the tree the
| whole time and the first green suite is what finally surfaced it.
|
| A control that only runs in CI is a control you meet late. This one runs in
| `composer check` with everything else.
|
| TRACKED FILES ONLY. Both halves ask git what this repository contains rather than
| walking the filesystem, because the filesystem answers a different question: the
| moment the frontend had dependencies installed, `flatted` (which ships a PHP port
| of its own format) and a Redocly test fixture appeared under node_modules and a
| filesystem walk called them violations. Neither is committed. The workflow step
| runs the same command, so the two controls cannot disagree -- they did, briefly,
| and two controls giving different answers is worse than either being wrong.
|
| @see docs/70-decisions/0007-separate-backend-frontend-trees.md
|
*/

/**
 * Files matching a pathspec that git actually tracks.
 *
 * @return list<string>
 */
function trackedFiles(string $pathspec): array
{
    $process = new Process(['git', 'ls-files', $pathspec], base_path('..'));
    $process->run();

    if (! $process->isSuccessful()) {
        return [];
    }

    return array_values(array_filter(
        array_map('trim', explode("\n", $process->getOutput())),
        fn (string $line) => $line !== '',
    ));
}

it('renders no Blade views, because product UI belongs to the frontend tree', function () {
    // Not a style preference. A Blade view here is the first step towards rendering
    // product UI from the backend, at which point the API stops being the only
    // contract between the two trees and they drift.
    //
    // This has fired twice in anger already: on `laravel new`'s stock welcome page,
    // and on the Blade views Scramble published for its docs UI within a minute of
    // being installed.
    //
    // Server-rendered documents (a prescription PDF) are a legitimate exception in
    // principle, but there are none today: nothing in the application calls view().
    // Add the exception when a document needs one, so the allowance is visible in
    // the diff that introduces it.
    $blade = trackedFiles('backend/**/*.blade.php');

    expect($blade)->toBeEmpty(
        "Blade views tracked under backend/: \n".implode("\n", $blade)
        ."\nProduct UI belongs in frontend/. See ADR-0007."
    );
});

it('keeps PHP out of the frontend tree', function () {
    // The same boundary from the other side, and no longer trivially true: the
    // frontend tree now exists.
    $php = trackedFiles('frontend/**/*.php');

    expect($php)->toBeEmpty("PHP tracked under frontend/: \n".implode("\n", $php));
});
