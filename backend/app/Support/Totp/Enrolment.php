<?php

namespace App\Support\Totp;

/**
 * A secret that has just been generated, on its way to exactly one HTTP response.
 *
 * THIS OBJECT CARRIES A LIVE CREDENTIAL. It exists for the few lines between
 * generating a secret and rendering it for the operator enrolling their
 * authenticator, and it must not be put anywhere else: not in a log line, not in
 * an audit event's metadata, not in a queued job's payload, not in a session.
 * The audit event for an enrolment records THAT one happened and to which
 * account, which is the whole of what an auditor needs and the whole of what is
 * safe to keep.
 *
 * There is deliberately no accessor that reads a stored secret back out. Once
 * this object goes out of scope the only two copies are the encrypted column and
 * the authenticator app the operator enrolled.
 *
 * "The authenticator app", stated that way on purpose. The device happens to be
 * a phone for most operators, and saying so once read as harmless -- but this
 * product removed a phone one-time-code channel deliberately
 * (2026_08_17_171200_drop_otp_codes_table.php), and a sentence in the second
 * factor's own value object that mentions an operator's phone is the sentence
 * somebody later cites when they propose sending a code to it. The second copy
 * lives in an app the operator installed, on whatever hardware they installed it
 * on, and no phone NUMBER is involved in any part of this surface.
 */
final readonly class Enrolment
{
    public function __construct(
        /** Base32, for an operator whose camera will not focus and who types it in. */
        public string $secret,
        /** The `otpauth://` URI, for the ones whose camera will. Contains the secret. */
        public string $uri,
    ) {}
}
