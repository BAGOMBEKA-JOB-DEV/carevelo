import type { AggregatorAccount, AggregatorProvider } from './types'

/**
 * WHAT EACH AGGREGATOR ACTUALLY ASKS THE CLINIC FOR, AND WHAT IT DOES AFTERWARDS.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS IS A TABLE OF FACTS AND NOT A PARAGRAPH IN A COMPONENT.
 *
 * The clinic's payment screen used to be able to say one thing, because there was one
 * implemented aggregator and the second was accepted only so a clinic could RECORD the
 * account it holds. That is no longer true: Flutterwave and Pesapal are both talked to,
 * they ask for differently-named credentials, they take the patient through different
 * journeys, and they report the outcome back by different means. A screen that keeps one
 * set of words for both is a screen that tells half its clinics something false.
 *
 * So the difference lives here, once, as data — and the screen renders whichever profile
 * the administrator has selected. The alternative was a `provider === 'pesapal'` ternary
 * beside every label, hint and sentence, which is the shape that drifts: somebody updates
 * four of the six and nobody notices the two that still say "secret key" to a clinic whose
 * aggregator has never used that phrase.
 *
 * ------------------------------------------------------------------------------
 * THE FIELD MAPPING IS NOT A GUESS AND MUST NOT BECOME ONE.
 *
 * The API has exactly two credential slots, `public_key` and `secret_key`, and they were
 * named for Flutterwave, where they mean what they say. Pesapal has no public key at all —
 * it has a CONSUMER KEY and a CONSUMER SECRET, both of them secret, which together buy a
 * bearer token. `PesapalClient::credentials()` reads the consumer key out of `public_key`
 * and the consumer secret out of `secret_key`, and says so in its own comment. That is the
 * whole basis of the labels below.
 *
 * The consequence is a rule this file exists to hold: for Pesapal, `public_key` is
 * REQUIRED, even though the API validates it `sometimes|nullable` because Flutterwave does
 * not need one. A Pesapal account saved with only a consumer secret is a credential pair
 * with a hole in it — every token request fails, verification fails, and the clinic is
 * told its key was refused when what actually happened is that half of it was never
 * entered. `requiresSecondHalf` is what stops that, and the Server Action checks it as
 * well as the browser, because `required` on an input is a courtesy and not a control.
 *
 * ------------------------------------------------------------------------------
 * NOTHING HERE DESCRIBES A CAPABILITY CAREVELO DOES NOT HAVE.
 *
 * Every sentence below is checkable against the client that implements it. When Pesapal
 * was accepted at onboarding and refused at verification, this file's ancestor said so in
 * as many words on the screen, because a clinic that enters credentials and hears nothing
 * concludes the software is broken rather than unfinished. The sentences moved when the
 * client landed, and they move again if it is ever withdrawn.
 *
 * @see backend/app/Services/Payments/Pesapal/PesapalClient.php — the credential mapping
 * @see backend/app/Services/Payments/AggregatorGateways.php — which client answers for whom
 */
export type AggregatorProfile = {
  readonly value: AggregatorProvider
  readonly label: string

  /** What THIS aggregator calls the credential stored in `secret_key`. */
  readonly secretLabel: string
  readonly secretHint: string

  /** What it calls the credential stored in `public_key`. */
  readonly secondLabel: string
  readonly secondHint: string

  /**
   * Whether a usable credential needs both halves.
   *
   * True for Pesapal, whose consumer key and consumer secret are one pair. False for
   * Flutterwave, where the public key is genuinely optional and a collection authorises on
   * the secret key alone.
   */
  readonly requiresSecondHalf: boolean

  /** Where in the aggregator's OWN dashboard the clinic finds the pair. */
  readonly whereToGet: string

  /** How the patient actually pays, in one line an administrator can repeat at the desk. */
  readonly patientJourney: string

  /** How Carevelo finds out that a payment worked. */
  readonly outcomeArrives: string

  /** What pressing "check these credentials" does today, truthfully. */
  readonly verification: string

  /**
   * Whether Carevelo registers a notification URL on the clinic's own account.
   *
   * Pesapal only, and it is the one piece of configuration a clinic does not do itself:
   * `PesapalGateway::notificationId()` registers the URL with the clinic's credentials the
   * first time it starts a collection and stores the id against the account. Flutterwave
   * has no equivalent — the clinic pastes a webhook URL into Flutterwave's own dashboard
   * and Carevelo never touches its configuration.
   */
  readonly registersNotificationUrl: boolean
}

const FLUTTERWAVE: AggregatorProfile = {
  value: 'flutterwave',
  label: 'Flutterwave',

  secretLabel: 'Secret key',
  secretHint:
    'Flutterwave calls this your secret key. It is what actually authorises a collection, '
    + 'so it is the one credential that is not optional.',

  secondLabel: 'Public key',
  secondHint: 'Optional for Flutterwave. Leave it empty if you do not have one to hand.',
  requiresSecondHalf: false,

  whereToGet:
    'Your Flutterwave dashboard, under Settings then API keys. The test and live keys are '
    + 'separate pairs — take them from the environment you pick above.',

  patientJourney:
    'Your patient gets a prompt on their own handset, sent by Flutterwave. They never leave '
    + 'the clinic’s booking page.',

  outcomeArrives:
    'Flutterwave signs a notification with your webhook secret. Carevelo checks that '
    + 'signature before believing a word of it.',

  verification:
    'Checked against Flutterwave straight away. Carevelo asks about a reference that does '
    + 'not exist, which proves the key without charging anybody.',

  registersNotificationUrl: false,
}

const PESAPAL: AggregatorProfile = {
  value: 'pesapal',
  label: 'Pesapal',

  secretLabel: 'Consumer secret',
  secretHint:
    'Pesapal issues a consumer key and a consumer secret as one pair. This is the secret '
    + 'half. Both halves are needed before Pesapal will issue Carevelo a token on your '
    + 'behalf.',

  secondLabel: 'Consumer key',
  secondHint:
    'The other half of the same pair. Required for Pesapal — a consumer secret on its own '
    + 'cannot be used, and saving one would leave you with a connection that fails at the '
    + 'counter rather than here.',
  requiresSecondHalf: true,

  whereToGet:
    'Your Pesapal merchant dashboard, under your account’s API keys. Sandbox and live '
    + 'are separate pairs — take them from the environment you pick above.',

  patientJourney:
    'Your patient is sent to a payment page hosted by Pesapal and returns to the clinic’s '
    + 'booking page when they are done.',

  outcomeArrives:
    'Pesapal calls a notification URL registered on your account. That call carries no '
    + 'status and no signature, by Pesapal’s design, so Carevelo treats it only as a '
    + 'prompt to go and ask Pesapal what actually happened.',

  verification:
    'Checked against Pesapal straight away. Carevelo requests a token with your consumer '
    + 'key and secret, which proves the pair without charging anybody.',

  registersNotificationUrl: true,
}

export const AGGREGATOR_PROFILES: readonly AggregatorProfile[] = [FLUTTERWAVE, PESAPAL]

/** The profile for a provider, or `null` for a string that is not one. */
export function aggregatorProfile(provider: string | null | undefined): AggregatorProfile | null {
  return AGGREGATOR_PROFILES.find((profile) => profile.value === provider) ?? null
}

/**
 * Which provider the screen should be dressed for.
 *
 * The URL wins, then whatever this clinic has already connected, then Flutterwave. The URL
 * comes first because the administrator has just pressed something that said so; the
 * connected provider comes second because an administrator arriving cold is almost always
 * looking at the account they already have.
 *
 * A value that is not a provider falls through to the same fallback chain rather than
 * throwing. It arrives in a search parameter, which anybody can type.
 */
export function selectedProfile(
  requested: string | undefined,
  account: AggregatorAccount,
): AggregatorProfile {
  return (
    aggregatorProfile(requested)
    ?? aggregatorProfile(account.status === 'unconfigured' ? null : account.provider)
    ?? FLUTTERWAVE
  )
}

/* ============================================================================
   PESAPAL'S NOTIFICATION URL
   ============================================================================ */

/**
 * Whether Pesapal has somewhere to send this clinic's notifications.
 *
 * WHY THIS MATTERS ENOUGH TO HAVE ITS OWN TYPE. Pesapal's inbound message carries no
 * status and no signature — it is a bare "something happened to this order id" — so the
 * whole of its value is that it makes Carevelo go and ask. Without a registered URL there
 * is no prompt, and a clinic learns that a patient paid only when the scheduled re-check
 * gets round to it. That is a slower, quieter failure than a refused credential, and a
 * quiet failure is exactly the kind this screen is supposed to make loud.
 *
 * `not_reported` IS ITS OWN ANSWER AND IS NOT DRESSED AS EITHER OF THE OTHER TWO.
 * `AggregatorAccountResource` enumerates its fields deliberately — adding one is a
 * disclosure decision about a clinic's merchant configuration — and at the time of writing
 * it publishes seven and none of them is this. So the reader below looks for the field the
 * resource would use if it published one, and where there is nothing to read it says there
 * is nothing to read. It does NOT default to "registered", which would be the console
 * inventing a reassurance, and it does NOT default to "unregistered", which would be the
 * console inventing an alarm.
 *
 * THE CAST IS DELIBERATE AND IS THE POINT. `AggregatorAccount` comes from the generated
 * contract, which this app may not edit and cannot regenerate on its own; a field the
 * backend adds is present in the JSON long before it is present in the type. Reading it
 * through an index signature is how a server response gets narrowed at RUNTIME rather than
 * asserted at compile time — the same argument `model/types.ts` makes for the checklist,
 * where a widened type is a claim about a shape and not a check of it.
 */
export type IpnRegistration = 'registered' | 'unregistered' | 'not_reported'

/** The field name this reader is waiting for, kept here so a grep finds it in one place. */
const IPN_REGISTERED_FIELD = 'ipn_registered'

export function ipnRegistration(account: AggregatorAccount): IpnRegistration {
  const reported = (account as unknown as Record<string, unknown>)[IPN_REGISTERED_FIELD]

  if (reported === true) {
    return 'registered'
  }

  if (reported === false) {
    return 'unregistered'
  }

  return 'not_reported'
}
