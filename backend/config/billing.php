<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Clinic subscription billing
    |--------------------------------------------------------------------------
    |
    | CAREVELO'S OWN REVENUE, and the only money Carevelo ever collects.
    |
    | Read this beside config/services.php, which says of Pesapal that there are
    | no credentials there and never will be. That statement is still true and
    | this file is not an exception to it: the credentials below authenticate
    | CAREVELO'S OWN merchant account, collecting CAREVELO'S OWN subscription
    | fee from a clinic. A clinic's Pesapal credentials still live encrypted on
    | that clinic's aggregator_accounts row and are still passed in per call,
    | because a patient's payment still settles to the clinic and never to us.
    |
    | ADR-0003 permits this in as many words -- "Revenue is subscription-only
    | (SS-F)" -- and permits nothing beyond it. The moment a patient's payment
    | could reach the account these credentials name, the design has drifted
    | into custody and into the NPS Act 2020 PSP and e-money issuer categories
    | at UGX 250m-10bn of capital.
    |
    | The separation is enforced, not merely intended:
    |   - PlatformMerchant reads ONLY this file and cannot be handed a tenant row
    |   - SubscriptionBilling touches neither aggregator_accounts nor
    |     payment_intents, and a test asserts it by watching the queries
    |   - platform_subscription_charges is invisible from inside any tenant
    |
    | @see docs/70-decisions/0003-non-custodial-payment-architecture.md
    |
    */

    'pesapal' => [
        /*
         * From the environment, never from a database row.
         *
         * AggregatorAccount is architecturally incapable of naming the
         * platform: it carries a tenant_id, it lives under row-level security,
         * and a row there means "a clinic's own merchant account". Storing the
         * platform's credentials in it would create the one thing ADR-0003 says
         * does not exist -- a platform merchant account among the clinics' --
         * and every existing lookup would then be one bug away from finding it.
         *
         * Unset in local and test environments, and that is deliberate: the
         * suspension sweep and the notification endpoint must behave sanely on
         * a machine with no Pesapal account, rather than blowing up or, worse,
         * silently charging nobody while appearing to work.
         */
        'consumer_key' => env('PLATFORM_PESAPAL_CONSUMER_KEY'),
        'consumer_secret' => env('PLATFORM_PESAPAL_CONSUMER_SECRET'),

        /*
         * `sandbox` or `live`. Defaulted to sandbox, because the failure of
         * getting this wrong is asymmetric: a live deployment misconfigured to
         * sandbox collects nothing and is noticed within a month, while a
         * sandbox deployment misconfigured to live bills real clinics real
         * money from a staging environment.
         */
        'environment' => env('PLATFORM_PESAPAL_ENVIRONMENT', 'sandbox'),

        /*
         * Pesapal's registered id for the notification URL of the PLATFORM
         * account. Distinct from the per-clinic `ipn_id` on aggregator_accounts
         * and registered against different credentials, so the two cannot be
         * interchanged.
         *
         * Configured rather than auto-registered: RegisterIPN is not idempotent
         * and there is exactly one platform account, so registering it once by
         * hand and recording the id is both simpler and safer than a lazy
         * registration that could run on every deployment.
         */
        'ipn_id' => env('PLATFORM_PESAPAL_IPN_ID'),
    ],

    /*
     * How long after a period ends before staff sign-in is blocked.
     *
     * NOT ZERO, and the reason is clinical rather than commercial. Mobile-money
     * collections in this market fail for reasons that have nothing to do with
     * willingness to pay -- a network outage, an agent float shortage at the
     * other end, a SIM swap -- and the recurring retry may land a day late.
     * Suspending at the stroke of midnight would close a clinic's front desk
     * over a telecom fault.
     *
     * Seven days is long enough for a retry and a phone call, short enough that
     * it is not a free extra week. It is a grace period, not a credit line: no
     * balance accrues anywhere, because no such concept exists in this system.
     */
    'grace_days' => 7,

];
