import type { ReactElement, ReactNode } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Badge, Button, Card, Field, Input, Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { recordConsent } from '../api/consents'
import { forgetRegistration, noteDecision } from '../api/handoff'
import type {
  ConsentAction,
  ConsentGrantedBy,
  ConsentPolicy,
  ConsentType,
} from '../api/types'
import { ConsentPolicyText } from './ConsentPolicyText'

/**
 * THE CONSENT SCREEN.
 *
 * "The most important screen in the product from a compliance standpoint" — H2 §2. Health
 * data is special-category data under Uganda's Data Protection and Privacy Act 2019, and
 * processing it without a valid, DEMONSTRABLE consent is a regulatory breach. Demonstrable
 * is the operative word: months from now we must be able to reconstruct exactly what this
 * person was shown and exactly what they agreed to. Every decision below is made to serve
 * that sentence.
 *
 * WHAT THE STATUTE AND THE PRD REQUIRE, AND WHERE EACH ONE IS DISCHARGED HERE:
 *
 *   A SEPARATE AFFIRMATIVE ACTION PER CONSENT TYPE. Each decision is its own `<form>` with
 *   its own submit button, and the decision — which type, and whether it is a grant or a
 *   decline — is BOUND INTO THE SERVER ACTION rather than carried in the request body. So
 *   there is no checkbox to arrive pre-ticked, no array that could bundle two consents
 *   behind one press, and no field a client could flip. Pressing a button is the whole of
 *   the affirmative action, and each button posts exactly one `consent_type`.
 *
 *   NO PRE-TICKED BOXES, NO BUNDLING, NO "BY CONTINUING YOU AGREE". There is no control on
 *   this screen with a default value, nothing agrees to two things at once, and there is no
 *   navigation off it that records anything. A patient who closes the tab has consented to
 *   nothing, which is the correct outcome and the one the law assumes.
 *
 *   WHY NOT ONE FORM WITH SEVERAL SUBMIT BUTTONS, which would let the guardian fields be
 *   typed once. Because pressing Enter in a text field submits a form's FIRST submit button
 *   — so a guardian typing their name and hitting Enter would record agreement to data
 *   processing without ever having read the question. On this screen that is not a rough
 *   edge, it is a fabricated consent. The guardian fieldset is therefore repeated per form,
 *   which is duplication accepted deliberately rather than overlooked. (HTML's `form=`
 *   attribute would share a control between forms, but it names exactly one form, so it
 *   cannot help here.)
 *
 *   THE FULL POLICY TEXT ON THE SAME SCREEN, IN BOTH LANGUAGES. Rendered inline, at length,
 *   in the reader's language, with the other language one `<summary>` away in the same
 *   document — a disclosure, not a link: nothing navigates, nothing fetches, and the words
 *   are already in the page for a screen reader browsing it. Everything the screen is
 *   required to STATE — what is collected, that health data is special-category, that the
 *   clinic is the controller and Carevelo the processor, the purpose, who sees it including
 *   the rider, retention, and the patient's rights — is in that text, written by the party
 *   that is legally answerable for it, and is rendered rather than paraphrased.
 *
 *   THE POLICY VERSION TRAVELS WITH THE DECISION, taken from the policy this screen actually
 *   rendered. The API refuses a version it is no longer serving, so a stale tab cannot
 *   record agreement to wording nobody can reproduce.
 *
 *   A DECLINE PATH THAT SAYS WHAT HAPPENS NEXT. It has its own section, its own heading and
 *   its own form at the foot of the page — deliberately far from "I agree", because a
 *   destructive decision one thumb-width from an agreement is a decision people make by
 *   accident. It says plainly that the patient may still attend in person and consent later.
 *
 * `delivery_disclosure` IS NOT ASKED HERE, and its absence is a requirement rather than an
 * omission: consent must be specific, and asking up front to share an address with a rider
 * who may never be dispatched is not specific. It is taken at the point delivery is chosen
 * (H4). The API enforces the same rule — it refuses that type while the record is still
 * `pending_consent` — and the screen says so rather than leaving a patient to wonder.
 *
 * A PLAIN FORM POST, NO 'use client', NO HOOK, NO onSubmit. The binding constraint is a
 * mid-range Android on variable mobile data, and this is the screen that must work when the
 * bundle has not arrived: a patient who cannot consent cannot be treated.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

/**
 * Everything a decision needs, bound into the action at render time.
 *
 * BOUND, NOT POSTED. Next signs the bound arguments of a Server Action, so `patientId`,
 * `consentType`, `affirmed` and the policy version reach the server as this component wrote
 * them. As hidden inputs they would be client-editable — and while the API authorises every
 * one of them independently, a screen that invites the browser to nominate whose record a
 * consent lands on has no business being the compliance screen.
 */
type Decision = {
  readonly patientId: string
  readonly consentType: ConsentType
  readonly affirmed: boolean
  readonly policyVersion: string
  readonly grantedBy: ConsentGrantedBy | undefined
  /** This screen's own path, so a decision posts and comes straight back to it. */
  readonly returnHref: string
}

async function submitDecision(decision: Decision, formData: FormData): Promise<void> {
  'use server'

  const { redirect } = await import('next/navigation')

  const guardian = decision.grantedBy === 'guardian'

  const result = await recordConsent({
    patientId: decision.patientId,
    consentType: decision.consentType,
    affirmed: decision.affirmed,
    policyVersion: decision.policyVersion,
    grantedBy: decision.grantedBy,
    guardianName: guardian ? String(formData.get('guardian_name') ?? '').trim() : undefined,
    guardianRelationship: guardian
      ? String(formData.get('guardian_relationship') ?? '').trim()
      : undefined,
  })

  if (!result.ok) {
    /*
     * THE API'S OWN SENTENCE, UNCHANGED. Every refusal this call can produce is a rule only
     * the backend holds — "the consent wording has changed", "a patient under 18 consents
     * through a guardian", "consent to process data comes first" — and each is already
     * written for the person who triggered it. Paraphrasing here would put a second,
     * drifting copy of those rules in front of a patient at the exact moment being wrong
     * costs the most.
     */
    redirect(`${decision.returnHref}?error=${encodeURIComponent(result.message)}`)
  }

  /*
   * Declining to have your data processed at all ENDS the registration: the record moves to
   * `discarded`, everything but the minimal contact detail is cleared, and it is purged on
   * schedule. There is nothing left for this browser to point at, so the pointer goes too.
   */
  if (decision.consentType === 'data_processing' && !decision.affirmed) {
    await forgetRegistration()

    redirect(`${decision.returnHref}?declined=1`)
  }

  await noteDecision(decision.consentType, decision.affirmed ? 'granted' : 'declined')

  redirect(decision.returnHref)
}
export type ConsentScreenProps = {
  tenant: Tenant
  /** As fetched for THIS render. Its version is what each decision pins. */
  policy: ConsentPolicy
  patientId: string
  /**
   * `guardian` when the patient is under 18. The API refuses a minor's own tick outright,
   * so this is not a nicety — omitting it on a minor's record produces a 422 rather than an
   * invalid consent, which is the right way round but a poor thing to discover by pressing.
   */
  grantedBy?: ConsentGrantedBy | undefined
  /** What is already on record, so nothing is asked twice. Display only; the API decides. */
  decided?: Readonly<Partial<Record<ConsentType, ConsentAction>>> | undefined
  /** This screen's own path. Every decision posts and returns here. */
  returnHref: string
  /** Where the journey goes once data processing is agreed. */
  continueHref: string
  /** The API's sentence from a failed decision, arriving back in the query string. */
  error?: string | undefined
}

export async function ConsentScreen({
  tenant,
  policy,
  patientId,
  grantedBy,
  decided,
  returnHref,
  continueHref,
  error,
}: ConsentScreenProps): Promise<ReactElement> {
  const [t, common, locale] = await Promise.all([
    getTranslations('Patients'),
    getTranslations('Common'),
    getLocale(),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')

  /*
   * The reader's language first, and a real fallback rather than a blank page.
   *
   * A screen that renders a consent form with no policy above it collects agreement to
   * nothing — so if the clinic's policy does not exist in the reader's language, the next
   * available language is shown AND the patient is told plainly that it is not theirs.
   * Where there is no policy at all, no decision is offered.
   */
  const languages = Object.keys(policy.text)
  const primary = policy.text[locale] !== undefined ? locale : (languages[0] ?? null)
  const primaryText = primary === null ? undefined : policy.text[primary]
  const secondary = languages.find((language) => language !== primary) ?? null
  const secondaryText = secondary === null ? undefined : policy.text[secondary]

  const processingGranted = decided?.data_processing === 'granted'
  const processingDecided = decided?.data_processing !== undefined
  const guardian = grantedBy === 'guardian'

  const actionLabels: Readonly<Record<ConsentAction, string>> = {
    granted: t('consent.agreed'),
    declined: t('consent.notAgreed'),
    withdrawn: t('consent.withdrawn'),
  }

  const guardianStrings: GuardianStrings = {
    legend: t('consent.guardianLegend'),
    name: t('consent.guardianName'),
    relationship: t('consent.guardianRelationship'),
    relationshipHint: t('consent.guardianRelationshipHint'),
  }

  const decisionFor = (consentType: ConsentType, affirmed: boolean): Decision => ({
    patientId,
    consentType,
    affirmed,
    policyVersion: policy.version,
    grantedBy,
    returnHref,
  })

  return (
    /*
     * ONE VERTICAL RHYTHM FOR THE WHOLE PAGE, set by a single-column grid rather than by a
     * margin on each block. The token layer has no margin utilities and `Notice` and `Card`
     * take a className but no style — so the alternative was a wrapper div around half the
     * elements here, each carrying the same number, each free to drift from the others.
     * A grid gap states the spacing once and applies it to every child including the ones
     * added later.
     */
    <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
      <div className="grid" style={{ gap: 'var(--space-8)' }}>
        <div className="site-sec-head">
          <span className="site-eyebrow">{t('consent.eyebrow')}</span>
          <h1 className="site-h1">{t('consent.title', { clinic })}</h1>
          <p className="site-lede">{t('consent.lede')}</p>
        </div>

        {guardian ? (
          <Notice tone="info" icon="users" title={t('consent.guardianNoticeTitle')} announce={false}>
            {t('consent.guardianNoticeBody')}
          </Notice>
        ) : null}

        {primaryText === undefined || primary === null ? (
          /*
           * No policy, no decision. Rendering the buttons without the wording would collect
           * a consent whose evidence trail describes text the patient never saw, which is
           * exactly what the pinned text hash exists to make impossible.
           */
          <Notice tone="bad" title={t('consent.policyUnavailableTitle')}>
            {t('consent.policyUnavailableBody', { clinic })}
          </Notice>
        ) : (
          <>
            {/* ---------------------------------------------------------------
                The policy itself. First on the page, in full, before anything
                on it asks for a decision — the order the requirement is in.

                The clinic's own tint: this section is the clinic speaking, and
                it is the one card on the screen that gets it.
                --------------------------------------------------------------- */}
            <Card as="section" aria-labelledby="consent-policy" tone="brand">
              {primary !== locale ? (
                <Notice tone="warn" announce={false}>
                  {t('consent.policyLanguageMissing')}
                </Notice>
              ) : null}

              <ConsentPolicyText text={primaryText} lang={primary} titleId="consent-policy" />

              <p className="subtitle" style={{ marginTop: 'var(--space-6)', fontSize: 13 }}>
                {t('consent.policyVersion', { version: policy.version })}
              </p>

              {secondaryText !== undefined && secondary !== null ? (
                /*
                 * A DISCLOSURE, NOT A LINK, and the difference is the requirement. The other
                 * language is already in this document — no navigation, no fetch, nothing to
                 * fail on a stalled connection — and `<details>` opens without JavaScript.
                 * Collapsed rather than open, because two full policies expanded at once is
                 * a page nobody reads either half of; the summary is written in the language
                 * it opens into, so it is legible to the person who needs it.
                 */
                <details style={{ marginTop: 'var(--space-6)' }}>
                  <summary
                    lang={secondary}
                    style={{
                      cursor: 'pointer',
                      // The whole row is the target, and it answers to the same 44px floor
                      // as every other control: this is opened one-handed, on a phone.
                      minHeight: 'var(--touch-min)',
                      display: 'flex',
                      alignItems: 'center',
                      fontWeight: 600,
                    }}
                  >
                    {secondary === 'lg' ? t('consent.readInLuganda') : t('consent.readInEnglish')}
                  </summary>

                  <ConsentPolicyText
                    text={secondaryText}
                    lang={secondary}
                    titleAs="h3"
                    headingAs="h4"
                  />
                </details>
              ) : null}
            </Card>

            {/* ---------------------------------------------------------------
                The decisions. One form each; nothing is ticked in advance.
                --------------------------------------------------------------- */}
            <div>
              <h2 className="site-h2">{t('consent.decisionsHeading')}</h2>
              <p className="site-lede">{t('consent.decisionsLede')}</p>
            </div>

            {error ? (
              /*
               * ONE form-level alert rather than an error per field: this arrives after a
               * navigation the patient started, and `humanise()` has already picked the
               * single sentence they should read first.
               */
              <Notice tone="bad">{error}</Notice>
            ) : null}

            <div className="grid g-2">
              <DecisionCard
                id="data_processing"
                title={t('consent.dataProcessingTitle')}
                body={t('consent.dataProcessingBody', { clinic })}
                action={decided?.data_processing}
                actionLabels={actionLabels}
              >
                {processingDecided ? null : (
                  <form action={submitDecision.bind(null, decisionFor('data_processing', true))}>
                    {guardian ? <GuardianFields idPrefix="dp" strings={guardianStrings} /> : null}

                    <Button variant="brand" size="lg" block type="submit">
                      {t('consent.agree')}
                    </Button>
                  </form>
                )}
              </DecisionCard>

              <DecisionCard
                id="telemedicine"
                title={t('consent.telemedicineTitle')}
                body={t('consent.telemedicineBody', { clinic })}
                action={decided?.telemedicine}
                actionLabels={actionLabels}
              >
                {decided?.telemedicine !== undefined ? null : processingGranted ? (
                  <div className="row-wrap">
                    <form action={submitDecision.bind(null, decisionFor('telemedicine', true))}>
                      {guardian ? (
                        <GuardianFields idPrefix="tm-yes" strings={guardianStrings} />
                      ) : null}

                      <Button variant="brand" type="submit">
                        {t('consent.agree')}
                      </Button>
                    </form>

                    <form action={submitDecision.bind(null, decisionFor('telemedicine', false))}>
                      {guardian ? (
                        <GuardianFields idPrefix="tm-no" strings={guardianStrings} />
                      ) : null}

                      <Button variant="quiet" type="submit">
                        {t('consent.decline')}
                      </Button>
                    </form>
                  </div>
                ) : (
                  /*
                   * The API refuses this outright until data processing has been granted —
                   * "Consent to process data comes first. Without it, nothing else can be
                   * agreed." Saying so is better than a button that answers 409, and much
                   * better than a disabled control with no explanation attached to it.
                   */
                  <Notice tone="neutral" icon="lock" announce={false}>
                    {t('consent.telemedicineLocked')}
                  </Notice>
                )}
              </DecisionCard>
            </div>

            {/*
              The third consent, and why it is not on this page. Stated rather than left
              out, so a patient who meets it later at the pharmacy is not surprised by a
              question they believed they had already answered.
            */}
            <Notice tone="info" icon="truck" title={t('consent.deliveryTitle')}>
              {t('consent.deliveryBody', { clinic })}
            </Notice>

            {processingGranted ? (
              <div className="site-btn-row">
                <Button variant="brand" size="lg" href={continueHref}>
                  {t('consent.continue')}
                </Button>
              </div>
            ) : null}

            {/* ---------------------------------------------------------------
                The decline path. Its own section, at the foot of the page, well
                away from "I agree" — and it says what happens next rather than
                only that something will.
                --------------------------------------------------------------- */}
            {processingDecided ? null : (
              <Card as="section" aria-labelledby="consent-decline" padding="tight">
                <h2 className="title" id="consent-decline">
                  {t('consent.declineHeading')}
                </h2>
                <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
                  {t('consent.declineBody', { clinic })}
                </p>
                <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
                  {t('consent.declineStillWelcome', { clinic })}
                </p>

                <form
                  action={submitDecision.bind(null, decisionFor('data_processing', false))}
                  style={{ marginTop: 'var(--space-6)' }}
                >
                  {guardian ? (
                    <GuardianFields idPrefix="decline" strings={guardianStrings} />
                  ) : null}

                  <Button variant="quiet" type="submit">
                    {t('consent.declineButton')}
                  </Button>
                </form>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One consent type: what it is, what agreeing does, and either the button or the answer.
 *
 * ONCE ANSWERED THE QUESTION IS GONE. A screen that keeps offering a decision already on
 * record invites a second identical `ConsentRecord`, which is noise in the one audit trail
 * that has to stay readable — and it reads to the patient as though their answer did not
 * take.
 */
function DecisionCard({
  id,
  title,
  body,
  action,
  actionLabels,
  children,
}: {
  id: string
  title: string
  body: string
  action: ConsentAction | undefined
  actionLabels: Readonly<Record<ConsentAction, string>>
  children: ReactNode
}): ReactElement {
  return (
    <Card as="section" aria-labelledby={`${id}-title`}>
      <div className="row between">
        <h3 className="title grow" id={`${id}-title`}>
          {title}
        </h3>

        {action === undefined ? null : (
          /* The word, not a colour: a coloured dot says nothing to a colour-blind patient
             and less to a screen reader. See Badge.tsx. */
          <Badge tone={action === 'granted' ? 'good' : 'neutral'}>{actionLabels[action]}</Badge>
        )}
      </div>

      <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
        {body}
      </p>

      <div style={{ marginTop: 'var(--space-6)' }}>{children}</div>
    </Card>
  )
}

type GuardianStrings = {
  legend: string
  name: string
  relationship: string
  relationshipHint: string
}

/**
 * The guardian's own details, recorded on the decision they are authoring.
 *
 * A patient under 18 consents through a guardian, for every consent type, and the
 * `ConsentRecord` carries the guardian's name and relationship so the decision has a named
 * author rather than only a timestamp. The guardian is identified IN PERSON by the staff
 * member taking the consent — the platform proves nothing about a guardian's phone number,
 * and nothing on this screen claims otherwise.
 */
function GuardianFields({
  idPrefix,
  strings,
}: {
  idPrefix: string
  strings: GuardianStrings
}): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
      <span className="field__label">{strings.legend}</span>

      {/* The id is prefixed because these two fields appear once per decision form on this
          page, and two controls sharing an id is a label pointing at the wrong box. The
          NAME stays unprefixed — that is what the API reads. */}
      <Field id={`${idPrefix}-guardian_name`} name="guardian_name" label={strings.name}>
        {(control) => (
          <Input {...control} type="text" maxLength={200} required autoComplete="name" />
        )}
      </Field>

      <Field
        id={`${idPrefix}-guardian_relationship`}
        name="guardian_relationship"
        label={strings.relationship}
        hint={strings.relationshipHint}
      >
        {(control) => <Input {...control} type="text" maxLength={60} required />}
      </Field>
    </div>
  )
}
