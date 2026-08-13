<?php

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\PaymentIntent;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Mandatory test 7 -- forbidden identifiers
|--------------------------------------------------------------------------
|
| These name entities that MUST NOT EXIST. Their absence is a compliance
| control, not a naming preference: custody of patient funds would trigger the
| NPS Act 2020 PSP / e-money categories and their UGX 250m-10bn capital
| requirements, which a bootstrapped business cannot meet.
|
| A blunt instrument, deliberately. It forces a conversation, and that
| conversation is exactly the control. Renaming a variable to pass this check
| is not compliance -- if it fires, the question is whether the thing being
| built is custody.
|
| See docs/50-security-compliance/payments-regulatory-boundary.md
|
*/

/** @return list<string> */
function forbiddenIdentifiers(): array
{
    return ['wallet', 'balance', 'float', 'escrow', 'payout', 'settlement'];
}

it('has no forbidden identifier in any database column', function () {
    $columns = DB::select("
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
    ");

    $violations = [];

    foreach ($columns as $column) {
        foreach (forbiddenIdentifiers() as $forbidden) {
            if (str_contains(strtolower($column->column_name), $forbidden)) {
                $violations[] = "{$column->table_name}.{$column->column_name} contains '{$forbidden}'";
            }
        }
    }

    expect($violations)->toBeEmpty(
        "Carevelo never takes custody of patient funds.\n".implode("\n", $violations)
    );
});

it('has no forbidden identifier in any table name', function () {
    $tables = DB::select("
        select table_name from information_schema.tables where table_schema = 'public'
    ");

    $violations = [];

    foreach ($tables as $table) {
        foreach (forbiddenIdentifiers() as $forbidden) {
            if (str_contains(strtolower($table->table_name), $forbidden)) {
                $violations[] = "{$table->table_name} contains '{$forbidden}'";
            }
        }
    }

    expect($violations)->toBeEmpty(implode("\n", $violations));
});

it('has no forbidden identifier in payment source code', function () {
    // 'float' is excluded here: it is a PHP type name and would match
    // legitimate code. The column and table checks above still cover it, which
    // is where a stored balance would actually have to live.
    $codeForbidden = ['wallet', 'escrow', 'payout', 'settlement'];

    $paths = [
        base_path('app/Models/PaymentIntent.php'),
        base_path('app/Models/AggregatorAccount.php'),
        base_path('app/Support/Money.php'),
    ];

    $violations = [];

    foreach ($paths as $path) {
        if (! file_exists($path)) {
            continue;
        }

        $source = strtolower(file_get_contents($path) ?: '');

        // Strip comments: the documentation deliberately NAMES these things in
        // order to forbid them, and that must not trip the check.
        $source = preg_replace('#/\*.*?\*/|//.*$#ms', '', $source) ?? '';

        foreach ($codeForbidden as $forbidden) {
            if (str_contains($source, $forbidden)) {
                $violations[] = basename($path)." contains '{$forbidden}'";
            }
        }
    }

    expect($violations)->toBeEmpty(implode("\n", $violations));
});

it('offers no way to refund from platform funds', function () {
    // Carevelo holds nothing to refund from. The method exists solely to make
    // that explicit to anyone who goes looking for it.
    $intent = new PaymentIntent;

    expect(fn () => $intent->refund())
        ->toThrow(IllegalTransition::class, 'never takes custody');
});
