<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    /*
     * Pesapal.
     *
     * NO CREDENTIALS HERE, and there never will be. A Pesapal consumer key and
     * secret belong to a CLINIC, live encrypted on that clinic's
     * aggregator_accounts row, and are passed into every call. There is no
     * platform merchant account for a platform credential to authenticate --
     * custody would trigger the NPS Act 2020 PSP and e-money categories.
     *
     * See docs/70-decisions/0003-non-custodial-payment-architecture.md
     */
    'pesapal' => [
        /*
         * Where Pesapal returns the PATIENT'S BROWSER after its hosted payment
         * page. The patient portal, not the API: it is a landing page, and the
         * payment is resolved by the notification endpoint and by the
         * reconciliation sweep, both of which read status from Pesapal itself.
         *
         * Unset falls back to APP_URL + /payments/return, which is right for a
         * single-host deployment and wrong for a split one -- so set it.
         */
        'callback_url' => env('PESAPAL_CALLBACK_URL'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
