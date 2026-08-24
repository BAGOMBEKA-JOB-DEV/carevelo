import type { components, operations } from '@carevelo/api-client'

/**
 * The shapes this domain speaks, taken from the generated contract.
 *
 * Every alias below is a POINTER into `packages/api-client/src/generated/schema.d.ts`, which
 * is generated from `docs/40-api/openapi.yaml` and committed. None of them describes a
 * field. That is the whole rule: a hand-written request or response type is a second copy of
 * the contract, and a second copy drifts silently — it keeps compiling long after the API
 * has moved, and the failure surfaces as a blank name on a patient's record rather than as a
 * build error. Aliasing costs nothing and fails loudly.
 *
 * @see docs/30-architecture/frontend-nextjs.md
 */

/** A patient, as clinic staff see them. `status` walks the H2 state machine. */
export type Patient = components['schemas']['PatientResource']

/** The patient lifecycle. A record in `pending_consent` may carry NO clinical data. */
export type PatientStatus = components['schemas']['PatientStatus']

/** The registration body. Mandatory: given name, family name, phone. Nothing else. */
export type RegistrationInput = components['schemas']['StorePatientRequest']

/** The demographic correction body. Every field optional — this is a PATCH, never a PUT. */
export type ProfileInput = components['schemas']['UpdatePatientRequest']

/**
 * The sex values the API accepts.
 *
 * `prefer_not_to_say` is one of them, and the form offers it as an ordinary option rather
 * than as an absence. A patient who declined to answer and a patient who was never asked are
 * different facts about a medical record, and only one of them is worth recording.
 */
export type Sex = NonNullable<RegistrationInput['sex']>

/** One immutable consent decision. Never updated — a withdrawal is a NEW record. */
export type ConsentRecord = components['schemas']['ConsentRecordResource']

/**
 * The three consent types, from the request body rather than from a resource.
 *
 * Deliberately taken from `StoreConsentRequest`, where the contract states them as an enum.
 * `ConsentRecordResource.consent_type` is a bare `string` — the backend serialises the
 * column, not the enum — so reading the union from the RESOURCE would silently widen it to
 * `string` and lose the exhaustiveness the display code depends on.
 */
export type ConsentType = components['schemas']['StoreConsentRequest']['consent_type']

/**
 * What a decision was.
 *
 * Written here rather than aliased, because `ConsentRecordResource.action` is a bare
 * `string` in the contract — the backend serialises the column rather than an enum, so there
 * is nothing narrower to point at. The three values are the controller's own: `granted`,
 * `declined` and `withdrawn`, and there is no fourth because a record is never updated.
 * Anything else arriving from the API falls through to the neutral rendering rather than
 * being coerced into one of these.
 */
export type ConsentAction = 'granted' | 'declined' | 'withdrawn'

/**
 * Who AUTHORED a consent decision — and note that "the member of staff at the desk" is not
 * one of the options, in the contract or here.
 *
 * `docs/50-security-compliance/rbac-matrix.md` puts a tick in the `patient` column for
 * "Consent — grant / withdraw" and a dash in every staff column, and the sentence underneath
 * it is the rule this whole domain is built around: "Consent is granted by the patient or
 * guardian only. Staff may facilitate in person, but the record names who attested."
 */
export type ConsentGrantedBy = NonNullable<
  components['schemas']['StoreConsentRequest']['granted_by']
>

/**
 * What `POST /v1/patients/{patient}/account` returns, once.
 *
 * `initial_password` is the only moment the plaintext exists outside the patient's own head.
 * It is stored as a hash, it is in no audit event, no log line and no SMS, and there is no
 * endpoint that can produce it again. Everything the account screen does follows from that
 * one fact.
 */
export type IssuedAccount =
  operations['v1.patients.account.store']['responses'][201]['content']['application/json']['data']

/*
 * ---------------------------------------------------------------------------
 * The one type below that is written rather than aliased, and exactly why.
 * ---------------------------------------------------------------------------
 *
 * GET /v1/consent-policies/current is the single endpoint whose generated type is WRONG, and
 * it is wrong in two directions at once. `ConsentController` says so in its own docblock —
 * this is a known contract imprecision, recorded rather than papered over:
 *
 *   1. `text` generates as an untyped array. The controller returns `array<string, string>`
 *      — a MAP keyed by language code, holding real English and real Luganda prose — and the
 *      generator flattens a PHP associative array to a list because PHP cannot tell the two
 *      apart. Consumed as generated, a language cannot be indexed out of it at all, and the
 *      consent screen has no policy to render.
 *   2. `version` generates as the literal current value, because the constant is visible in
 *      the controller and looks like a fixed part of the contract. It is the opposite — it
 *      is designed to change, and a client that pinned it would break on the first policy
 *      revision.
 *
 * So this type overrides those fields and derives everything else. `text_hash` still comes
 * from the generated payload, and so does the payload's own key set: adding a field to the
 * endpoint without touching this file is a compile error rather than a shrug. When
 * openapi.yaml describes `text` as a list of `{language, body}` objects, this override
 * should be deleted and the alias collapsed like every other.
 */
type PolicyPayload =
  operations['v1.consent.policy']['responses'][200]['content']['application/json']['data']

export type ConsentPolicy = Omit<PolicyPayload, 'version' | 'consent_types' | 'text'> & {
  /** Widened from the generated literal. Pinned into every ConsentRecord as evidence. */
  version: string
  /**
   * Widened from the generated tuple. The clinic decides which consents it collects, and a
   * frontend that has hard-coded three of them cannot render a fourth.
   */
  consent_types: readonly ConsentType[]
  /**
   * The full policy, keyed by language code — `en` and `lg` today.
   *
   * Keyed by `string` rather than by a two-language union, because the API decides which
   * languages the clinic's policy exists in and a client that had hard-coded the pair could
   * not render a third. `noUncheckedIndexedAccess` makes the lookup `string | undefined`,
   * which is the correct shape: a language the policy has not been translated into is
   * genuinely absent, and the desk has to notice rather than hand a patient a screen reading
   * `undefined` and ask them to agree to it.
   */
  text: Readonly<Record<string, string>>
}
