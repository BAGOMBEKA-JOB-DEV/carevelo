import type { components, operations } from '@carevelo/api-client'

/**
 * The shapes this domain speaks, taken from the generated contract.
 *
 * Every alias below is a POINTER into packages/api-client/src/generated/schema.d.ts, which
 * is generated from docs/40-api/openapi.yaml and committed. None of them describes a field.
 * That is the whole rule: a hand-written request or response type is a second copy of the
 * contract, and a second copy drifts silently — it keeps compiling long after the API has
 * moved, and the failure surfaces as a blank name on a patient's own record rather than as
 * a build error. Aliasing costs nothing and fails loudly.
 *
 * @see docs/30-architecture/frontend-nextjs.md
 */

/** A patient record. `status` walks the H2 state machine; see PatientStatus below. */
export type Patient = components['schemas']['PatientResource']

/** One immutable consent decision. Never updated — a withdrawal is a NEW record. */
export type ConsentRecord = components['schemas']['ConsentRecordResource']

/**
 * The three consent types, from the request body rather than from a resource.
 *
 * Deliberately taken from `StoreConsentRequest`, where the contract states them as an
 * enum. `ConsentRecordResource.consent_type` is a bare `string` — the backend serialises
 * the column, not the enum — so reading the union from the RESOURCE would silently widen
 * it to `string` and lose the exhaustiveness the display code depends on.
 */
export type ConsentType = components['schemas']['StoreConsentRequest']['consent_type']

/**
 * What a decision was.
 *
 * Written here rather than aliased, because `ConsentRecordResource.action` is a bare
 * `string` in the contract — the backend serialises the column rather than an enum, so
 * there is nothing narrower to point at. The three values are the controller's own:
 * `granted`, `declined` and `withdrawn`, and there is no fourth because a record is never
 * updated. Anything else arriving from the API falls through to the neutral rendering
 * rather than being coerced into one of these.
 */
export type ConsentAction = 'granted' | 'declined' | 'withdrawn'

/** Who authored a consent decision. A minor consents through a guardian, for every type. */
export type ConsentGrantedBy = NonNullable<
  components['schemas']['StoreConsentRequest']['granted_by']
>

/** The registration body. Mandatory: given name, family name, phone. Nothing else. */
export type RegistrationInput = components['schemas']['StorePatientRequest']

/** The demographic correction body. Every field optional — this is a PATCH. */
export type ProfileInput = components['schemas']['UpdatePatientRequest']

/**
 * The sex values the API accepts.
 *
 * `prefer_not_to_say` is one of them, and the form offers it as an ordinary option rather
 * than as an absence. A patient who declines to answer and a patient who was never asked
 * are different facts about a medical record, and only one of them is worth recording.
 */
export type Sex = NonNullable<RegistrationInput['sex']>

/** The patient lifecycle. `pending_consent` may carry NO clinical data. */
export type PatientStatus = components['schemas']['PatientStatus']

/*
 * ---------------------------------------------------------------------------
 * The one type below that is written rather than aliased, and exactly why.
 * ---------------------------------------------------------------------------
 *
 * GET /v1/consent-policies/current is the single endpoint whose generated type is WRONG,
 * and it is wrong in two directions at once:
 *
 *   1. `text` generates as `unknown[]`. The controller returns
 *      `array<string, string>` — a MAP keyed by language code, holding the clinic's own
 *      prose — and the schema generator flattens a PHP associative array to a list.
 *      Consumed as generated, the policy cannot be indexed out of it at all, and the
 *      consent screen has no policy to render.
 *   2. `version` generates as the literal `"2026-08-01"`, because the controller's
 *      constant is inlined into the schema. Trusting that literal would let the compiler
 *      prove a runtime equality that only holds until the clinic's policy is next
 *      reworded — and the whole point of the version is that it CHANGES.
 *
 * So this type overrides those two fields and derives everything else. `text_hash` still
 * comes from the generated payload, and so does the payload's own key set: adding a field
 * to the endpoint without touching this file is a compile error rather than a shrug.
 *
 * The generator defect is reported rather than worked around quietly — see the handover
 * note for this domain. When openapi.yaml describes `text` as an object, this override
 * should be deleted and the alias collapsed to the generated type like every other.
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
   * The full policy, keyed by language code — `en` alone today.
   *
   * KEYED BY `string` RATHER THAN BY THE PORTAL'S OWN `Locale`, AND DELIBERATELY LEFT THAT
   * WAY WHEN THE PORTAL DROPPED TO ONE LANGUAGE. The API decides which languages a clinic's
   * policy exists in; the portal decides which languages it reads its own chrome in. Those
   * are different facts, and typing this against `Locale` would assert that they must agree
   * — so a clinic publishing its policy under a code this portal does not hold would stop
   * compiling rather than simply rendering the clinic's own words with the clinic's own
   * `lang` attribute, which is what ConsentScreen does. `noUncheckedIndexedAccess` makes
   * the lookup `string | undefined`, which is the correct shape: a policy that did not
   * arrive is genuinely absent, and the screen has to notice rather than print `undefined`
   * at a patient who is being asked to agree to it.
   */
  text: Readonly<Record<string, string>>
}
