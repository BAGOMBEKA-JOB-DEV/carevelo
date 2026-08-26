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

        // Subscription billing, added when Carevelo became the merchant for its
        // OWN revenue. This is the half of the system where the temptation is
        // strongest and the reader's guard is lowest: "we are collecting our own
        // money, so surely a balance is fine". It is not. The words below name
        // regulated activities whoever the money belongs to, and a `payout` or a
        // `settlement` in this domain would be the first sign that platform
        // revenue had started behaving like custody of somebody else's.
        base_path('app/Models/PlatformSubscriptionCharge.php'),
        base_path('app/Services/Billing/SubscriptionBilling.php'),
        base_path('app/Services/Billing/RecurringChargeResolver.php'),
        base_path('app/Services/Billing/PlatformMerchant.php'),
        base_path('config/billing.php'),

        /*
         * The rest of the path a clinic's subscription payment actually takes.
         *
         * The five entries above name where the money is DECIDED. These name
         * where it is REQUESTED, RECEIVED and RECORDED, and leaving them out
         * left the two files most likely to grow a convenience -- the operator's
         * controller and the public notification endpoint -- outside a check
         * whose stated subject is "the half of the system where the temptation
         * is strongest". A `payout` would not appear first in a value object; it
         * would appear in a controller, as a method somebody added to make a
         * support conversation easier.
         *
         * This list is an allowlist, so every file is uncovered until it is
         * written down here. A new file in app/Services/Billing belongs in it.
         */
        base_path('app/Services/Billing/SubscriptionNotificationLedger.php'),
        base_path('app/Services/Billing/SubscriptionPeriod.php'),
        base_path('app/Http/Controllers/Api/Platform/PlatformSubscriptionController.php'),
        base_path('app/Http/Controllers/Webhooks/PlatformBillingIpnController.php'),
        base_path('app/Http/Requests/Platform/UpdateSubscriptionRequest.php'),
        base_path('app/Http/Resources/Platform/PlatformSubscriptionResource.php'),

        /*
         * The credential seam and the transport both merchants share. Shared
         * transport is the safe half of the sharing -- see PesapalClient -- but
         * it is also the one class that speaks for Carevelo AND for a clinic, so
         * it is the one place a word describing what happens to somebody else's
         * money would do the most damage.
         */
        base_path('app/Services/Payments/Pesapal/PesapalCredentials.php'),
        base_path('app/Services/Payments/Pesapal/PesapalClient.php'),
    ];

    $violations = [];

    foreach ($paths as $path) {
        if (! file_exists($path)) {
            continue;
        }

        $source = strtolower(file_get_contents($path) ?: '');

        /*
         * Strip comments: the documentation deliberately NAMES these things in
         * order to forbid them, and that must not trip the check.
         *
         * `//[^\n]*` RATHER THAN `//.*$`, AND THE DIFFERENCE IS THE WHOLE
         * CONTROL. A block comment spans lines, so the first alternative needs
         * the `s` modifier -- and `s` applies to the pattern, not to one branch
         * of it, so `.` also matched a newline inside `//.*$`. `.*` is greedy;
         * it therefore ran from the FIRST line comment in a file to the last
         * byte of the file, where `$` duly matched. Everything below that point
         * was deleted before the search ever looked at it.
         *
         * That was not a cosmetic defect in a test. Measured against the files
         * named above, this control was reading between 5% and 35% of them --
         * RecurringChargeResolver.php has its first line comment at line 62 of
         * 291, so the resolver that applies Pesapal's word about CAREVELO'S OWN
         * revenue was scanned down to line 62 and no further. A `settlement` or
         * a `payout` anywhere beneath it passed the build in silence, which is
         * the precise failure mode a compliance check must not have: green, and
         * inert.
         *
         * Verified rather than reasoned about: renaming extendPaidThrough() to
         * extendSettlementDate() in that file was NOT detected by the old
         * pattern and IS detected by this one.
         *
         * A character class cannot cross a line however greedy it is, so the
         * two alternatives no longer interfere and `m` is no longer needed.
         */
        $source = preg_replace('#/\*.*?\*/|//[^\n]*#s', '', $source) ?? '';

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
