import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Badge, Button, Card, DateTime, EmptyState, Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { latestDecisions, withdrawConsent, type ConsentHistoryPage } from '../api/consents'
import type { ConsentType } from '../api/types'

/**
 * What a patient has agreed to, when, and to which wording — and how to take it back.
 *
 * HISTORY, NOT CURRENT STATE, AND THAT IS THE POINT. A withdrawal is a NEW record; the grant
 * it revokes is left exactly as it was written. So this screen lists every decision in
 * sequence — grants, declines and withdrawals together — rather than a tidy "you have
 * consented to X" summary. A consent history that can be edited proves nothing at all, and
 * one that quietly hides superseded entries is indistinguishable from one that can.
 *
 * THE VERSION AND THE FINGERPRINT ARE SHOWN ON PURPOSE. `policy_version` and
 * `policy_text_hash` are what make a record verifiable BY SOMEBODY OUTSIDE THE SYSTEM: take
 * the hash, re-render the versioned policy, and confirm the wording was not changed
 * afterwards. Hiding them because they look technical would leave the patient with a claim
 * and no way to check it. They are behind a `<details>` so they do not shout at somebody who
 * only wanted to know what they said yes to.
 *
 * WHAT THE WORDING MUST NOT PROMISE, and this is the sentence the whole screen is written
 * around: withdrawing halts NEW processing; it does not delete a medical record the clinic
 * may be legally obliged to keep. The tension between the right to withdraw and the duty to
 * retain is real, it is the clinic's to resolve as controller, and pretending otherwise
 * would be a promise nobody can keep. "A promise we cannot keep is worse than an honest
 * explanation."
 *
 * CURSOR PAGINATION, never offset — decisions are written while this page is being read.
 * "Show more" is an ordinary link carrying the next cursor, so it works with no JavaScript
 * at all.
 *
 * @see docs/50-security-compliance/data-retention-and-deletion.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

type Withdrawal = {
  readonly patientId: string
  readonly consentType: ConsentType
  readonly returnHref: string
}

async function submitWithdrawal(withdrawal: Withdrawal): Promise<void> {
  'use server'

  const { redirect } = await import('next/navigation')

  const result = await withdrawConsent(withdrawal.patientId, withdrawal.consentType)

  if (!result.ok) {
    // Including "There is no active consent of that kind to withdraw", which is what a
    // second press on a stale page produces. The API's sentence says exactly that; a
    // paraphrase would have to guess which of several 409s it was.
    redirect(`${withdrawal.returnHref}?error=${encodeURIComponent(result.message)}`)
  }

  redirect(`${withdrawal.returnHref}?withdrawn=${withdrawal.consentType}`)
}

export type ConsentHistoryProps = {
  tenant: Tenant
  patientId: string
  /** One page of decisions, newest first, as the API ordered them. */
  page: ConsentHistoryPage
  /** This screen's own path. Withdrawals post and return here; "show more" appends a cursor. */
  returnHref: string
  error?: string | undefined
  /** The type just withdrawn, echoed back so the page can confirm it happened. */
  withdrawn?: string | undefined
}

export async function ConsentHistory({
  tenant,
  patientId,
  page,
  returnHref,
  error,
  withdrawn,
}: ConsentHistoryProps): Promise<ReactElement> {
  const [t, common] = await Promise.all([
    getTranslations('Patients'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')

  /*
   * The labels resolved once, as plain maps.
   *
   * The alternative is handing the translator itself to the helpers below, which typechecks
   * only for as long as the catalogue holds exactly the keys those helpers ask for — so
   * renaming a key would fail inside a helper that has nothing to do with the rename. A map
   * keeps every catalogue lookup in the component that owns the namespace, and it is also
   * what lets `label()` fall back to the API's own value for a consent type this build has
   * never heard of.
   */
  const typeLabels: Readonly<Record<string, string>> = {
    data_processing: t('types.dataProcessing'),
    telemedicine: t('types.telemedicine'),
    delivery_disclosure: t('types.deliveryDisclosure'),
  }

  const actionLabels: Readonly<Record<string, string>> = {
    granted: t('actions.granted'),
    declined: t('actions.declined'),
    withdrawn: t('actions.withdrawn'),
  }

  /*
   * Which consents are live right now, derived from the records themselves rather than
   * tracked separately — the server's own evidence is the only thing entitled to answer it.
   *
   * Computed over the page in hand. The API orders newest first, so the current state of
   * every type is on the first page unless a patient has made more than twenty-five
   * decisions; past that, a withdraw button may be missing from a later page, which costs a
   * click back to the first rather than an incorrect action.
   */
  const latest = latestDecisions(page.records)

  const withdrawable: readonly ConsentType[] = (
    ['data_processing', 'telemedicine', 'delivery_disclosure'] as const
  ).filter((type) => latest[type]?.action === 'granted')

  return (
    <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
      <div className="grid" style={{ gap: 'var(--space-7)' }}>
        <div className="site-sec-head">
          <span className="site-eyebrow">{t('history.eyebrow')}</span>
          <h1 className="site-h1">{t('history.title')}</h1>
          <p className="site-lede">{t('history.lede', { clinic })}</p>
        </div>

        {error ? <Notice tone="bad">{error}</Notice> : null}

        {withdrawn ? (
          <Notice tone="info" icon="check" announce title={t('history.withdrawnTitle')}>
            {t('history.withdrawnBody', { clinic })}
          </Notice>
        ) : null}

        {page.records.length === 0 ? (
          <Card as="section" aria-label={t('history.title')}>
            <EmptyState icon="file" title={t('history.emptyTitle')}>
              {t('history.emptyBody', { clinic })}
            </EmptyState>
          </Card>
        ) : (
          <ul className="grid" style={{ gap: 'var(--space-5)', listStyle: 'none' }}>
            {page.records.map((record) => (
              <Card as="li" key={record.id} padding="tight">
                <div className="row between">
                  <span className="title-sm grow">{label(typeLabels, record.consent_type)}</span>

                  {/*
                    The word carries the state, never the colour alone. `warn` for a
                    withdrawal rather than `bad`: withdrawing is a right being exercised
                    correctly, not a failure, and painting it red would tell a patient they
                    had done something wrong.
                  */}
                  <Badge tone={badgeTone(record.action)}>{label(actionLabels, record.action)}</Badge>
                </div>

                <p className="subtitle" style={{ marginTop: 'var(--space-3)', fontSize: 13.5 }}>
                  {record.occurred_at === null ? null : (
                    <DateTime value={record.occurred_at} format="datetime" />
                  )}
                </p>

                {record.granted_by === 'guardian' && record.guardian_name !== null ? (
                  <p className="subtitle" style={{ marginTop: 'var(--space-2)', fontSize: 13.5 }}>
                    {t('history.byGuardian', {
                      name: record.guardian_name,
                      relationship: record.guardian_relationship ?? t('history.unstatedRelationship'),
                    })}
                  </p>
                ) : null}

                <details style={{ marginTop: 'var(--space-4)' }}>
                  <summary style={SUMMARY}>{t('history.evidenceSummary')}</summary>

                  <p className="subtitle" style={{ marginTop: 'var(--space-3)', fontSize: 13 }}>
                    {t('history.evidenceNote')}
                  </p>

                  <dl className="stack" style={{ marginTop: 'var(--space-4)' }}>
                    <dt className="field__label">{t('history.versionLabel')}</dt>
                    <dd className="tnum">{record.policy_version}</dd>

                    <dt className="field__label" style={{ marginTop: 'var(--space-3)' }}>
                      {t('history.fingerprintLabel')}
                    </dt>
                    {/* Whole, not truncated: a shortened hash cannot be checked against
                        anything, which would make showing it theatre. */}
                    <dd style={{ wordBreak: 'break-all', fontSize: 12.5 }}>
                      <code>{record.policy_text_hash}</code>
                    </dd>
                  </dl>
                </details>
              </Card>
            ))}
          </ul>
        )}

        {page.nextCursor === null ? null : (
          <div className="site-btn-row">
            {/*
              An ordinary link carrying the cursor. Not a button, not a fetch: pressing it
              navigates, which works with the bundle in flight and gives a patient a URL they
              can go back from.
            */}
            <Button
              variant="quiet"
              href={`${returnHref}?cursor=${encodeURIComponent(page.nextCursor)}`}
            >
              {t('history.showMore')}
            </Button>
          </div>
        )}

        {/* ---------------------------------------------------------------
            Withdrawal. One form per consent, because withdrawal is per type
            for the same reason granting is — a patient who no longer wants
            remote consultations has not withdrawn consent to be treated.
            --------------------------------------------------------------- */}
        {withdrawable.length === 0 ? null : (
          <Card as="section" aria-labelledby="withdraw-heading">
            <h2 className="title" id="withdraw-heading">
              {t('history.withdrawHeading')}
            </h2>

            {/*
              THE SENTENCE THAT MUST NOT OVERPROMISE. Read the retention document before
              editing a word of it: withdrawal halts new processing and does not delete a
              record the clinic is obliged to keep, and the clinic will say plainly which
              parts can be removed and which cannot.
            */}
            <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
              {t('history.withdrawStops', { clinic })}
            </p>
            <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
              {t('history.withdrawDoesNotDelete', { clinic })}
            </p>

            <div className="row-wrap" style={{ marginTop: 'var(--space-6)' }}>
              {withdrawable.map((type) => (
                <form
                  key={type}
                  action={submitWithdrawal.bind(null, {
                    patientId,
                    consentType: type,
                    returnHref,
                  })}
                >
                  <Button variant="quiet" type="submit">
                    {t('history.withdrawButton', { consent: label(typeLabels, type) })}
                  </Button>
                </form>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * A label from a catalogue map, falling back to the API's own value.
 *
 * `ConsentRecordResource.consent_type` and `.action` are bare strings in the contract, so an
 * unrecognised value is a real possibility rather than a defensive fiction — a consent type
 * added to the API before this catalogue learns about it. It falls through to the raw value
 * rather than to an empty cell, because a patient reading their own consent history is
 * better served by an unfamiliar word than by a blank where a decision should be.
 */
function label(labels: Readonly<Record<string, string>>, value: string): string {
  return labels[value] ?? value
}

function badgeTone(action: string): 'good' | 'warn' | 'neutral' {
  switch (action) {
    case 'granted':
      return 'good'
    case 'withdrawn':
      return 'warn'
    default:
      return 'neutral'
  }
}

/** The disclosure row is a control, so it answers to the same 44px touch floor. */
const SUMMARY = {
  cursor: 'pointer',
  minHeight: 'var(--touch-min)',
  display: 'flex',
  alignItems: 'center',
  fontWeight: 600,
} as const
