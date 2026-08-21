import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { Icon } from '@carevelo/ui'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { SiteShell } from '@/components/SiteShell'

/**
 * The clinic's front door.
 *
 * SERVER-RENDERED, WITH THE CLINIC'S COLOURS IN THE FIRST BYTE. A patient on a slow
 * connection sees their clinic — not a spinner, and never a flash of Carevelo's colours
 * where the clinic's should be. That flash is the entire proposition of a white-label
 * product, lost.
 *
 * What the page has to do: tell a patient who has been sent a link by their clinic what
 * this is, what it will cost them in effort, and that it is safe. In that order, because
 * that is the order the questions arrive in.
 *
 * NO NUMBERS WE HAVE NOT EARNED. The stat band below the hero is the one place a
 * marketing page reaches for traction figures, and this product has none: no patients
 * served, no consultations completed, no clinics live. So the band states facts about the
 * JOURNEY — four steps, any hour, all of the money to the clinic, no queue — every one of
 * which is true on the first day of the first clinic. An invented "12,000 patients" would
 * be the single fastest way to lose a clinic owner who knows the market.
 *
 * IT NOW READS IN THE LANGUAGE IT ADVERTISES. The chip below the hero has said "English &
 * Luganda" since the first commit and the feature cell further down has promised that a
 * patient chooses which — "including the consent you are asked to give" — while there was
 * not one translation primitive in the tree and <html lang> was hard-coded. Every string
 * on this page comes out of messages/ now, and the footer carries the control that
 * switches between them.
 *
 * Zero client JavaScript on this page, still. Every icon is a server-rendered <svg>, the
 * FAQ is native <details>, the translations are resolved on the server, and the only
 * component that hydrates on the whole surface is the header's scroll listener.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export default async function HomePage() {
  const [tenant, user, t, common] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Home'),
    getTranslations('Common'),
  ])
  const clinic = tenant.trading_name ?? common('thisClinic')
  const district = tenant.contact?.district

  return (
    <SiteShell tenant={tenant} signedIn={Boolean(user)}>
      {/* ---- Hero ----
          One column on a dark band. The reference runs a two-track grid because it has a
          photograph for the second track; we have neither a photograph of this clinic nor
          a product screenshot that would not be a lie until booking exists. */}
      <section className="site-hero">
        <div className="site-hero__bg" aria-hidden="true" />

        <div className="site-wrap site-hero__inner">
          <span className="site-eyebrow">
            {district ? t('eyebrowDistrict', { district }) : t('eyebrowCountry')}
          </span>

          {/*
           * `t.rich` rather than a sentence split in two around the highlighted span. The
           * emphasis falls on a phrase, and which phrase that is depends on the language:
           * a translator who receives "See a clinician at {clinic}" and "without leaving
           * home." as two separate strings cannot move the break, and in a language whose
           * clause order differs from English the break is in the wrong place.
           */}
          <h1 className="site-h1">
            {t.rich('heroTitle', {
              clinic,
              g: (chunks) => <span className="g">{chunks}</span>,
            })}
          </h1>

          <p className="site-lede">{t('heroLede', { clinic })}</p>

          <div className="site-hero__cta site-btn-row">
            {user ? (
              /* Somebody with a session does not need to be sold the product they are
                 already inside. One button, straight to their care. */
              <Link className="btn btn-brand btn-lg" href="/account">
                {t('goToMyCare')}
              </Link>
            ) : (
              <>
                <Link className="btn btn-brand btn-lg" href="/sign-in">
                  {t('bookConsultation')}
                </Link>
                <Link className="btn btn-quiet btn-lg" href="#how">
                  {t('seeHowItWorks')}
                </Link>
              </>
            )}
          </div>

          <div className="site-chips">
            <span className="site-chip">
              <Icon name="check" /> {t('chipMobileMoney')}
            </span>
            <span className="site-chip">
              <Icon name="check" /> {t('chipAnyPhone')}
            </span>
            <span className="site-chip">
              <Icon name="check" /> {t('chipLanguages')}
            </span>
          </div>
        </div>
      </section>

      {/* ---- The journey, in four numbers ----
          Sitting on the hero's bottom edge. Read them as claims and every one is checkable
          against the product rather than against a database we would have to be trusted
          about.

          The numeral and its unit are ONE message with a <u> tag rather than two strings,
          for the same reason as the hero: "4 steps" is one noun phrase and a language that
          puts the count after the noun needs to be able to say so. */}
      <div className="site-wrap stat-band--overlap">
        <div className="stat-band">
          <div className="stat-band__it">
            <div className="stat-band__n">
              {t.rich('stats.stepsValue', { u: (chunks) => <span className="u">{chunks}</span> })}
            </div>
            <div className="stat-band__l">{t('stats.stepsLabel')}</div>
          </div>

          <div className="stat-band__it">
            <div className="stat-band__n">
              {t.rich('stats.hoursValue', { u: (chunks) => <span className="u">{chunks}</span> })}
            </div>
            <div className="stat-band__l">{t('stats.hoursLabel')}</div>
          </div>

          <div className="stat-band__it">
            <div className="stat-band__n">
              {t.rich('stats.shareValue', { u: (chunks) => <span className="u">{chunks}</span> })}
            </div>
            {/* Not a rounding. The payment architecture is non-custodial: the money moves
                from the patient to the clinic's own merchant account and Carevelo is never
                in the path. */}
            <div className="stat-band__l">{t('stats.shareLabel')}</div>
          </div>

          <div className="stat-band__it">
            <div className="stat-band__n">{t('stats.queuesValue')}</div>
            <div className="stat-band__l">{t('stats.queuesLabel')}</div>
          </div>
        </div>
      </div>

      {/* ---- How it works ---- */}
      <section className="site-section site-section--tint" id="how">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">{t('how.eyebrow')}</span>
            <h2 className="site-h2">{t('how.title')}</h2>
            <p className="site-lede">{t('how.lede')}</p>
          </div>

          <div className="cellgrid cellgrid--4">
            <div className="cell">
              <div className="cell__n">1</div>
              <h3>{t('how.bookTitle')}</h3>
              <p>{t('how.bookBody', { clinic })}</p>
            </div>

            <div className="cell">
              <div className="cell__n">2</div>
              <h3>{t('how.payTitle')}</h3>
              <p>{t('how.payBody', { clinic })}</p>
            </div>

            <div className="cell">
              <div className="cell__n">3</div>
              <h3>{t('how.consultTitle')}</h3>
              <p>{t('how.consultBody')}</p>
            </div>

            <div className="cell">
              <div className="cell__n">4</div>
              <h3>{t('how.collectTitle')}</h3>
              <p>{t('how.collectBody', { clinic })}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- What a patient actually gets ---- */}
      <section className="site-section" id="care">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">{t('care.eyebrow')}</span>
            <h2 className="site-h2">{t('care.title')}</h2>
            <p className="site-lede">{t('care.lede', { clinic })}</p>
          </div>

          <div className="cellgrid cellgrid--3">
            <div className="cell">
              <div className="cell__ic">
                <Icon name="phone" />
              </div>
              <h3>{t('care.consultTitle')}</h3>
              <p>{t('care.consultBody')}</p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="file" />
              </div>
              <h3>{t('care.prescriptionTitle')}</h3>
              <p>{t('care.prescriptionBody')}</p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="truck" />
              </div>
              <h3>{t('care.deliveryTitle')}</h3>
              <p>{t('care.deliveryBody', { clinic })}</p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="coins" />
              </div>
              <h3>{t('care.receiptsTitle')}</h3>
              <p>{t('care.receiptsBody', { clinic })}</p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="users" />
              </div>
              <h3>{t('care.familyTitle')}</h3>
              <p>{t('care.familyBody')}</p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="help" />
              </div>
              <h3>{t('care.languageTitle')}</h3>
              {/* The claim this whole change exists to make true. The control that
                  delivers it is in the footer. */}
              <p>{t('care.languageBody')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Safety and privacy ---- */}
      <section className="site-section site-section--tint" id="trust">
        <div className="site-wrap site-split">
          <div>
            <span className="site-eyebrow">{t('trust.eyebrow')}</span>
            <h2 className="site-h2">{t('trust.title')}</h2>

            <ul className="ticklist">
              <li>
                <span className="tk">
                  <Icon name="check" />
                </span>
                <div>
                  <b>{t('trust.licensedLead')}</b>{' '}
                  <span>{t('trust.licensedBody', { clinic })}</span>
                </div>
              </li>

              <li>
                <span className="tk">
                  <Icon name="check" />
                </span>
                <div>
                  {/*
                   * Load-bearing, and not marketing. Carevelo never holds patient money:
                   * the clinic's own merchant credentials sit at a licensed aggregator and
                   * collections go directly to the clinic. Saying so here is the
                   * promise the payments architecture actually keeps — and it has to
                   * survive translation, which is why the whole claim is one message
                   * rather than a sentence assembled around the clinic's name.
                   */}
                  <b>{t('trust.paymentLead')}</b>{' '}
                  <span>{t('trust.paymentBody', { clinic })}</span>
                </div>
              </li>

              <li>
                <span className="tk">
                  <Icon name="check" />
                </span>
                <div>
                  <b>{t('trust.recordsLead')}</b>{' '}
                  <span>{t('trust.recordsBody', { clinic })}</span>
                </div>
              </li>
            </ul>
          </div>

          {/*
           * A prescription, because that is this product's subject — not a dashboard and
           * not a chart. Everything in it is obviously a sample: a common antibiotic, a
           * dose line and a collection row, laid out to show what the screen will look
           * like. Nothing here is advice, and the panel says so at the bottom, because a
           * plausible-looking prescription with no such line is a thing somebody will
           * eventually screenshot and act on.
           *
           * THE DOSE LINE IS ON THE TRANSLATION WORKLIST AND MUST STAY THERE UNTIL A
           * HUMAN CLEARS IT. "One capsule, three times a day, after food" is dosage
           * language, and dosage language guessed at in a second language is the one kind
           * of wrong string on this page that could hurt somebody. Until a translator
           * writes it, the Luganda catalogue holds the English sentence — visibly foreign,
           * which is the honest failure — rather than a plausible invention.
           *
           * Built from inline values rather than a class, deliberately: this is one sample
           * on one page, and a set of .rx-* rules in the shared token layer would be CSS
           * that no second screen ever uses. Every value is a design token, so it moves
           * with the theme and with the clinic's colour like everything around it.
           */}
          <div className="site-split__media">
            <div className="mockup">
              <div className="mockup__bar" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>

              <div className="mockup__body">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--space-4)',
                    paddingBottom: 'var(--space-4)',
                    borderBottom: '1px solid var(--hairline)',
                  }}
                >
                  <span className="stat__label">{t('mockup.label')}</span>
                  <span className="fine">{t('mockup.writtenBy')}</span>
                </div>

                <div style={{ marginTop: 'var(--space-5)' }}>
                  <div className="title-sm">{t('mockup.drug')}</div>
                  <div className="fine" style={{ marginTop: 'var(--space-2)' }}>
                    {t('mockup.form')}
                  </div>
                  <p style={{ marginTop: 'var(--space-3)', color: 'var(--ink-muted)' }}>
                    {t('mockup.dose')}
                  </p>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-4)',
                    marginTop: 'var(--space-5)',
                    paddingTop: 'var(--space-4)',
                    borderTop: '1px solid var(--hairline)',
                  }}
                >
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {t('mockup.dispensedBy', { clinic })}
                  </span>
                  <span className="badge badge-good">
                    <Icon name="check" /> {t('mockup.collected')}
                  </span>
                </div>

                <p className="fine" style={{ marginTop: 'var(--space-4)' }}>
                  {t('mockup.disclaimer')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Questions ----
          Native <details>. It opens with no JavaScript, and the browser's own in-page
          search still finds text inside a closed one — which a scripted accordion breaks,
          on the exact page where somebody is hunting for the one answer they came for. */}
      <section className="site-section" id="questions">
        <div className="site-wrap">
          <div className="site-sec-head" style={{ marginInline: 'auto', textAlign: 'center' }}>
            <span className="site-eyebrow">{t('faq.eyebrow')}</span>
            <h2 className="site-h2">{t('faq.title')}</h2>
          </div>

          <div className="faq">
            <details>
              <summary>{t('faq.costQuestion')}</summary>
              <p>{t('faq.costAnswer', { clinic })}</p>
            </details>

            <details>
              <summary>{t('faq.smartphoneQuestion')}</summary>
              <p>{t('faq.smartphoneAnswer', { clinic })}</p>
            </details>

            <details>
              <summary>{t('faq.networkQuestion')}</summary>
              <p>{t('faq.networkAnswer', { clinic })}</p>
            </details>

            <details>
              <summary>{t('faq.recordsQuestion')}</summary>
              <p>{t('faq.recordsAnswer', { clinic })}</p>
            </details>

            <details>
              {/*
               * The honest answer, and it is a no. Signing in is an email address and a
               * password; the phone one-time-code flow is gone from the product and its
               * endpoints are gone from the API. Papering over that with "contact us"
               * would send a patient round a loop that has no exit, so this says plainly
               * what to do instead — which is the thing that has always worked.
               */}
              <summary>{t('faq.emailQuestion')}</summary>
              <p>{t('faq.emailAnswer', { clinic })}</p>
            </details>
          </div>
        </div>
      </section>

      {/* ---- Close ---- */}
      <section className="site-section site-section--tint">
        <div className="site-wrap">
          <div className="cta-band">
            <span className="site-eyebrow">{t('close.eyebrow')}</span>
            <h2>{t('close.title', { clinic })}</h2>
            <p>{t('close.body')}</p>

            <div className="site-btn-row">
              {user ? (
                <Link className="btn btn-brand btn-lg" href="/account">
                  {t('goToMyCare')}
                </Link>
              ) : (
                <Link className="btn btn-brand btn-lg" href="/sign-in">
                  {t('close.signIn', { clinic })}
                </Link>
              )}

              {tenant.contact?.phone ? (
                <a className="site-textlink" href={`tel:${tenant.contact.phone}`}>
                  <Icon name="phone" /> {t('close.call', { phone: tenant.contact.phone })}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
