<?php

namespace App\Http\Controllers\Api\Admin;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Aggregator\UpdateAggregatorAccountRequest;
use App\Http\Resources\V1\AggregatorAccountResource;
use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use App\Models\Tenant;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\PaymentGateway;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/**
 * The clinic connecting its OWN merchant account.
 *
 * This endpoint is the point at which the non-custodial architecture stops being
 * a paragraph in a document and becomes a row in a table. The credentials belong
 * to the clinic, the collection is made with them, and the money moves from the
 * patient to the aggregator to the clinic without passing through anything
 * Carevelo owns -- because Carevelo owns no such account. Custody would put us
 * inside the NPS Act 2020 PSP or e-money categories and their UGX 250m-10bn
 * capital requirements.
 *
 * Two invariants run through every method:
 *
 *   1. CREDENTIALS ARE WRITE-ONLY. They go in and never come out -- not to the
 *      administrator who typed them, not to Carevelo, not into a log line or an
 *      exception message.
 *   2. A MISSING ACCOUNT IS NOT AN ERROR. `unconfigured` is a working state and
 *      the clinic keeps seeing patients on pay-at-clinic. Nothing here may
 *      block care.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 5
 */
class AggregatorAccountController extends Controller
{
    public function __construct(protected AuditLog $audit) {}

    /**
     * Provider, status, environment and the last verification time.
     *
     * Four facts and no secret. Returns 200 with `unconfigured` when the clinic
     * has no account at all -- a 404 would read to a console as an error and
     * invite it to block booking over a feature the clinic has chosen not to
     * use.
     */
    public function show(Request $request): AggregatorAccountResource
    {
        $account = $this->currentAccountOrPlaceholder($request);

        $this->authorize('view', $account);

        return new AggregatorAccountResource($account);
    }

    /**
     * Store the clinic's credentials, replacing whatever was there.
     *
     * The status drops to `pending_verification` on every write, including a
     * write that only rotates the webhook secret. An untested credential
     * claiming to be `active` is how a clinic discovers at the counter that its
     * key expired last week.
     */
    public function update(UpdateAggregatorAccountRequest $request): AggregatorAccountResource
    {
        $account = $this->currentAccountOrPlaceholder($request);

        $this->authorize('update', $account);

        $account->fill($request->validated());
        $account->status = 'pending_verification';
        $account->last_verified_at = null;

        // A registered notification id belongs to the merchant account that
        // registered it. Credentials are replaced as a SET here, so the new set
        // may be a different Pesapal merchant entirely -- and a stale id would
        // point Pesapal at a notification URL registered under someone else's
        // account, or at nothing. Cleared, and registered again on the next
        // collection.
        $account->setAttribute('ipn_id', null);

        $account->save();

        $this->audit->record(
            'aggregator_account.configured',
            subjectType: 'AggregatorAccount',
            subjectId: $account->id,
            // Provider, environment, outcome. No key, no fragment of a key, not
            // even its length -- an audit trail is read by more people, and kept
            // for longer, than the credential store it describes.
            metadata: [
                'provider' => $account->provider,
                'environment' => $account->getAttribute('environment'),
                'status' => $account->status,
            ],
        );

        return new AggregatorAccountResource($account);
    }

    /**
     * Check the credentials against the aggregator.
     *
     * A READ, not a transaction. The gateway is asked about an attempt that
     * does not exist, which exercises exactly what needs exercising -- whether
     * the aggregator accepts this clinic's key -- and moves no money at all.
     * Initiating a real collection to test a credential would mean charging
     * somebody to prove a configuration, and there is no platform account for
     * the shilling to land in.
     *
     * Each provider has its own harmless equivalent of that question, and the
     * gateway chooses it: Flutterwave is asked to verify a reference it has
     * never seen, and Pesapal is asked for a token, which is the only call it
     * offers that tests a credential without creating an order. The probe below
     * carries no tracking id, and that absence is what selects the second path.
     *
     * A provider with no client at all is refused by the resolver with the same
     * AggregatorUnavailable, so verification stays truthful rather than silent.
     *
     * An unreachable or rejecting aggregator sets `failing` and returns the
     * aggregator's own message. Only they know why a key was refused, and
     * paraphrasing loses the part the administrator can act on.
     */
    public function verify(Request $request, PaymentGateway $gateway): AggregatorAccountResource
    {
        $account = $this->currentAccountOrPlaceholder($request);

        $this->authorize('update', $account);

        $secret = $account->secret_key;

        if (! $account->exists || ! is_string($secret) || $secret === '') {
            throw new IllegalTransition(
                'There are no credentials to verify. A clinic without its own aggregator account '
                .'keeps working on pay-at-clinic; connect the account when the clinic has one.'
            );
        }

        $probe = new PaymentIntent(['reference' => 'VERIFY-'.Str::upper(Str::random(12))]);
        // Never persisted. A probe row would enter the reconciliation sweep and
        // sit in the clinic's payment history as an attempt nobody made.
        $probe->setAttribute('id', (string) Str::ulid());

        $message = null;

        try {
            $gateway->fetchStatus($account, $probe);

            $account->status = 'active';
            $account->last_verified_at = Date::now();
        } catch (AggregatorUnavailable $e) {
            // Caught, not propagated. A refused credential is an onboarding step
            // to retry, not a 500 -- and onboarding continues either way.
            $account->status = 'failing';
            $message = $e->getMessage();
        }

        $account->save();

        $this->audit->record(
            'aggregator_account.verified',
            subjectType: 'AggregatorAccount',
            subjectId: $account->id,
            metadata: [
                'provider' => $account->provider,
                'environment' => $account->getAttribute('environment'),
                'status' => $account->status,
            ],
        );

        return (new AggregatorAccountResource($account))->additional([
            'meta' => ['verification_message' => $message],
        ]);
    }

    /**
     * The tenant's account, or an unsaved stand-in describing its absence.
     *
     * The query names no tenant: row-level security decides which row is
     * visible, so this cannot return another clinic's credentials even if
     * someone later adds a filter to it.
     *
     * The stand-in carries `tenant_id` so the policy's same-tenant check has
     * something real to answer, which keeps authorisation identical whether or
     * not a row exists.
     */
    private function currentAccountOrPlaceholder(Request $request): AggregatorAccount
    {
        $account = AggregatorAccount::query()->first();

        if ($account !== null) {
            return $account;
        }

        $tenant = $request->attributes->get('tenant');

        $placeholder = new AggregatorAccount([
            'environment' => 'sandbox',
            'status' => 'unconfigured',
        ]);

        $placeholder->setAttribute('tenant_id', $tenant instanceof Tenant ? $tenant->id : null);

        return $placeholder;
    }
}
