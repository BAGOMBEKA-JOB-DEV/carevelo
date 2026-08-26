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

/**
 * A file's source with every comment removed, lower-cased.
 *
 * ONE implementation, shared by both source-code checks below. Two copies of a
 * compliance control drifting apart is a failure this repository has already
 * met: RejectsUnknownFields existed as four near-identical copies and the
 * weakest of them quietly permitted what the others refused.
 *
 * WHY COMMENTS ARE STRIPPED AT ALL: the documentation deliberately NAMES these
 * things in order to forbid them, and that must not trip the check.
 *
 * `//[^\n]*` RATHER THAN `//.*$`, AND THE DIFFERENCE IS THE WHOLE CONTROL. A
 * block comment spans lines, so the first alternative needs the `s` modifier --
 * and `s` applies to the pattern, not to one branch of it, so `.` also matched
 * a newline inside `//.*$`. `.*` is greedy; it therefore ran from the FIRST
 * line comment in a file to the last byte of the file, where `$` duly matched.
 * Everything below that point was deleted before the search ever looked at it.
 *
 * That was not a cosmetic defect in a test. Measured against the files listed
 * in the checks below, this control was reading between 5% and 35% of them --
 * RecurringChargeResolver.php has its first line comment at line 62 of 291, so
 * the resolver that applies Pesapal's word about CAREVELO'S OWN revenue was
 * scanned down to line 62 and no further. A `settlement` or a `payout` anywhere
 * beneath it passed the build in silence, which is the precise failure mode a
 * compliance check must not have: green, and inert.
 *
 * Verified rather than reasoned about: renaming extendPaidThrough() to
 * extendSettlementDate() in that file was NOT detected by the old pattern and
 * IS detected by this one.
 *
 * A character class cannot cross a line however greedy it is, so the two
 * alternatives no longer interfere and `m` is no longer needed.
 */
function sourceWithoutComments(string $path): string
{
    $source = strtolower(file_get_contents($path) ?: '');

    return preg_replace('#/\*.*?\*/|//[^\n]*#s', '', $source) ?? '';
}

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

        /*
         * Consultation media, which is in a payments check for a reason that is
         * not obvious and is worth one paragraph.
         *
         * ADR-0004 chose to self-host the media server, and the argument that
         * decided it was arithmetic about money: a per-minute provider takes
         * between a tenth and three times a UGX 150,000 subscription. That turned
         * a directory which had never discussed money into one that discusses
         * almost nothing else -- a fixed server bill, bandwidth we pay for, a
         * relay whose traffic is on our meter. The vocabulary of paying for
         * infrastructure sits one word away from the vocabulary of holding
         * somebody else's money, and "the media budget" is exactly the kind of
         * phrase that grows a `balance` without anybody deciding to add one.
         *
         * This list is an allowlist, so a new file is uncovered until it is
         * written down. A new file in app/Support/Video belongs in it.
         */
        base_path('app/Support/Video/VideoProvider.php'),
        base_path('app/Support/Video/LiveKitVideoProvider.php'),
        base_path('app/Support/Video/LiveKitAccessToken.php'),
        base_path('app/Support/Video/UnconfiguredVideoProvider.php'),
        base_path('config/video.php'),
    ];

    $violations = [];

    foreach ($paths as $path) {
        if (! file_exists($path)) {
            continue;
        }

        $source = sourceWithoutComments($path);

        foreach ($codeForbidden as $forbidden) {
            if (str_contains($source, $forbidden)) {
                $violations[] = basename($path)." contains '{$forbidden}'";
            }
        }
    }

    expect($violations)->toBeEmpty(implode("\n", $violations));
});

it('has no forbidden identifier in consultation chat source code', function () {
    /*
     * THE CHAT SURFACE, ON ITS OWN LIST AND WITH ITS OWN WORD LIST.
     *
     * The check above reads the files where money is decided, requested and
     * recorded. This one reads a domain that touches no money at all, and it
     * exists because of what chat IS: the one place in the product where a
     * clinic types free prose TO A PATIENT, in-band, inside a clinical record.
     *
     * `balance` is checked here and is NOT checked above. That is the entire
     * reason this is a separate test rather than six more entries in the
     * payments array. The payments check excludes `balance` and `float` because
     * `float` is a PHP type name, and the schema checks at the top of this file
     * already cover the place a stored figure would actually have to live -- a
     * column. But the mistake chat invites is not a column. It is a hardcoded
     * string: a system-message template, a validation message or a canned
     * prompt saying "your outstanding balance is". The house rule bans these
     * words in COPY as well as in code, and a template string in a controller
     * or a form request is copy that this check can actually read.
     *
     * `float` stays excluded for the same reason as above: it is a PHP type.
     *
     * THIS LIST IS AN ALLOWLIST, so every file is uncovered until it is written
     * down here. A new file in the consultation chat domain belongs in it, and
     * so does any file that grows a message template.
     */
    $chatForbidden = ['wallet', 'balance', 'escrow', 'payout', 'settlement'];

    $paths = [
        base_path('app/Models/ConsultationMessage.php'),
        base_path('app/Models/ConsultationMessageAuthor.php'),
        base_path('app/Http/Controllers/Api/V1/ConsultationMessageController.php'),
        base_path('app/Http/Requests/V1/Consultations/StoreConsultationMessageRequest.php'),
        base_path('app/Http/Resources/V1/ConsultationMessageResource.php'),
        base_path('app/Events/ConsultationMessageSent.php'),

        // The ability that decides who may speak. Not obviously chat, and that
        // is why it is named: a policy is where an exception gets written, and
        // "except when the clinic is chasing an unpaid consultation" is exactly
        // the kind of exception somebody would try to express here.
        base_path('app/Policies/ConsultationPolicy.php'),
    ];

    $violations = [];

    foreach ($paths as $path) {
        if (! file_exists($path)) {
            $violations[] = basename($path).' is on the allowlist but does not exist';

            continue;
        }

        $source = sourceWithoutComments($path);

        foreach ($chatForbidden as $forbidden) {
            if (str_contains($source, $forbidden)) {
                $violations[] = basename($path)." contains '{$forbidden}'";
            }
        }
    }

    expect($violations)->toBeEmpty(
        "Carevelo never takes custody of patient funds, and a clinic must never \n"
        ."say otherwise to a patient inside a clinical record.\n".implode("\n", $violations)
    );
});

it('offers no way to refund from platform funds', function () {
    // Carevelo holds nothing to refund from. The method exists solely to make
    // that explicit to anyone who goes looking for it.
    $intent = new PaymentIntent;

    expect(fn () => $intent->refund())
        ->toThrow(IllegalTransition::class, 'never takes custody');
});
