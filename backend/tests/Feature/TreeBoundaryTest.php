<?php

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
| @see docs/70-decisions/0007-separate-backend-frontend-trees.md
|
*/

it('renders no Blade views, because product UI belongs to the frontend tree', function () {
    // Not a style preference. A Blade view here is the first step towards
    // rendering product UI from the backend, at which point the API stops being
    // the only contract between the two trees and they drift.
    //
    // Server-rendered documents (a prescription PDF) are a legitimate exception
    // in principle, but there are none today: nothing in the application calls
    // view(). Add the exception when a document actually needs one, so the
    // allowance is visible in the diff that introduces it.
    $blade = [];

    $directory = new RecursiveDirectoryIterator(resource_path(), FilesystemIterator::SKIP_DOTS);

    foreach (new RecursiveIteratorIterator($directory) as $file) {
        if (str_ends_with($file->getFilename(), '.blade.php')) {
            $blade[] = str_replace(base_path().'/', '', $file->getPathname());
        }
    }

    expect($blade)->toBeEmpty(
        "Blade views under backend/: \n".implode("\n", $blade)
        ."\nProduct UI belongs in frontend/. See ADR-0007."
    );
});

it('keeps PHP out of the frontend tree', function () {
    // The same boundary from the other side. Skipped rather than failed when the
    // frontend tree does not exist yet, so this asserts something real the day
    // it lands instead of needing to be remembered then.
    $frontend = base_path('../frontend');

    if (! is_dir($frontend)) {
        expect(true)->toBeTrue();

        return;
    }

    $php = [];

    $directory = new RecursiveDirectoryIterator($frontend, FilesystemIterator::SKIP_DOTS);

    foreach (new RecursiveIteratorIterator($directory) as $file) {
        $path = $file->getPathname();

        if (str_contains($path, '/node_modules/')) {
            continue;
        }

        if (str_ends_with($file->getFilename(), '.php')) {
            $php[] = $path;
        }
    }

    expect($php)->toBeEmpty("PHP under frontend/: \n".implode("\n", $php));
});
