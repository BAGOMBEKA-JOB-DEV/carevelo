import Link from 'next/link'
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
 * Zero client JavaScript on this page. Every icon is a server-rendered <svg>, the FAQ is
 * native <details>, and the only component that hydrates on the whole surface is the
 * header's scroll listener.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export default async function HomePage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])
  const clinic = tenant.trading_name ?? 'this clinic'
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
          <span className="site-eyebrow">{district ? `${district} · Uganda` : 'Uganda'}</span>

          <h1 className="site-h1">
            See a clinician at {clinic} <span className="g">without leaving home.</span>
          </h1>

          <p className="site-lede">
            Book a consultation, speak to a clinician by video, voice or chat, pay with
            mobile money, and have your medicine dispensed and brought to you. Your records
            stay with {clinic}.
          </p>

          <div className="site-hero__cta site-btn-row">
            {user ? (
              /* Somebody with a session does not need to be sold the product they are
                 already inside. One button, straight to their care. */
              <Link className="btn btn-brand btn-lg" href="/account">
                Go to my care
              </Link>
            ) : (
              <>
                <Link className="btn btn-brand btn-lg" href="/sign-in">
                  Book a consultation
                </Link>
                <Link className="btn btn-quiet btn-lg" href="#how">
                  See how it works
                </Link>
              </>
            )}
          </div>

          <div className="site-chips">
            <span className="site-chip">
              <Icon name="check" /> MTN &amp; Airtel money
            </span>
            <span className="site-chip">
              <Icon name="check" /> Works on any phone with a browser
            </span>
            <span className="site-chip">
              <Icon name="check" /> English &amp; Luganda
            </span>
          </div>
        </div>
      </section>

      {/* ---- The journey, in four numbers ----
          Sitting on the hero's bottom edge. Read them as claims and every one is checkable
          against the product rather than against a database we would have to be trusted
          about. */}
      <div className="site-wrap stat-band--overlap">
        <div className="stat-band">
          <div className="stat-band__it">
            <div className="stat-band__n">
              4 <span className="u">steps</span>
            </div>
            <div className="stat-band__l">from booking to medicine in hand</div>
          </div>

          <div className="stat-band__it">
            <div className="stat-band__n">
              24<span className="u">/7</span>
            </div>
            <div className="stat-band__l">book whenever it suits you</div>
          </div>

          <div className="stat-band__it">
            <div className="stat-band__n">
              100<span className="u">%</span>
            </div>
            {/* Not a rounding. The payment architecture is non-custodial: the money moves
                from the patient to the clinic's own merchant account and Carevelo is never
                in the path. */}
            <div className="stat-band__l">of what you pay goes to the clinic</div>
          </div>

          <div className="stat-band__it">
            <div className="stat-band__n">0</div>
            <div className="stat-band__l">queues to sit in</div>
          </div>
        </div>
      </div>

      {/* ---- How it works ---- */}
      <section className="site-section site-section--tint" id="how">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">How it works</span>
            <h2 className="site-h2">Four steps, start to medicine in hand.</h2>
            <p className="site-lede">
              Nothing to install and nothing to post. If you can open a web page, you can do
              all of this.
            </p>
          </div>

          <div className="cellgrid cellgrid--4">
            <div className="cell">
              <div className="cell__n">1</div>
              <h3>Book</h3>
              <p>
                Choose a clinician and a time that suits you. {clinic} confirms it, and you
                get a reminder before it starts.
              </p>
            </div>

            <div className="cell">
              <div className="cell__n">2</div>
              <h3>Pay</h3>
              <p>
                Approve the payment on your phone with MTN or Airtel money. The fee belongs
                to {clinic}, and you see it before you approve anything.
              </p>
            </div>

            <div className="cell">
              <div className="cell__n">3</div>
              <h3>Consult</h3>
              <p>
                Speak to your clinician by video, by voice, or by typing when the network is
                poor. You choose, and so can they.
              </p>
            </div>

            <div className="cell">
              <div className="cell__n">4</div>
              <h3>Collect</h3>
              <p>
                Read your prescription, then collect your medicine from {clinic} or have it
                brought to you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- What a patient actually gets ---- */}
      <section className="site-section" id="care">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">Your care</span>
            <h2 className="site-h2">Everything about your visit, in one place.</h2>
            <p className="site-lede">
              One account at {clinic}, holding the consultation, what was prescribed, where
              the medicine is, and what you paid.
            </p>
          </div>

          <div className="cellgrid cellgrid--3">
            <div className="cell">
              <div className="cell__ic">
                <Icon name="phone" />
              </div>
              <h3>Consult however the network allows</h3>
              <p>
                Video when the connection is good, voice when it is not, and typing when it
                is worse. The consultation does not fail because the signal did.
              </p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="file" />
              </div>
              <h3>Read your own prescription</h3>
              <p>
                What was prescribed, how much of it and how to take it — in writing, on your
                phone, for as long as you need it.
              </p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="truck" />
              </div>
              <h3>Follow your delivery</h3>
              <p>
                See when your medicine leaves {clinic} and when it is close. The rider is
                told where to go, never what is in the package.
              </p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="coins" />
              </div>
              <h3>Keep every receipt</h3>
              <p>
                Every payment you make to {clinic} is receipted and kept, so you can show
                what you paid and when.
              </p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="users" />
              </div>
              <h3>Book for your family</h3>
              <p>
                A parent or guardian can book and consult on behalf of a child, with the
                consent recorded properly rather than assumed.
              </p>
            </div>

            <div className="cell">
              <div className="cell__ic">
                <Icon name="help" />
              </div>
              <h3>Ask in your language</h3>
              <p>
                The portal reads in English and Luganda, and you choose which — including
                the consent you are asked to give.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Safety and privacy ---- */}
      <section className="site-section site-section--tint" id="trust">
        <div className="site-wrap site-split">
          <div>
            <span className="site-eyebrow">Safety and privacy</span>
            <h2 className="site-h2">Your clinic. Your records. Your money.</h2>

            <ul className="ticklist">
              <li>
                <span className="tk">
                  <Icon name="check" />
                </span>
                <div>
                  <b>Care from a licensed clinic.</b>{' '}
                  <span>
                    {clinic} is a licensed private clinic and the clinician you speak to is
                    registered to practise. Carevelo provides the software — never the care,
                    and never the diagnosis.
                  </span>
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
                   * promise the payments architecture actually keeps.
                   */}
                  <b>Payment goes to the clinic.</b>{' '}
                  <span>
                    Money moves from you to {clinic}, through the clinic&apos;s own mobile
                    money account. Carevelo never holds it, never keeps it for you, and
                    cannot take anything out of your account.
                  </span>
                </div>
              </li>

              <li>
                <span className="tk">
                  <Icon name="check" />
                </span>
                <div>
                  <b>Only your clinic sees your records.</b>{' '}
                  <span>
                    Your consultation notes and prescriptions belong to {clinic} and are
                    visible to the staff there involved in your care. No other clinic using
                    Carevelo can reach them.
                  </span>
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
                  <span className="stat__label">Prescription · sample</span>
                  <span className="fine">Written by your clinician</span>
                </div>

                <div style={{ marginTop: 'var(--space-5)' }}>
                  <div className="title-sm">Amoxicillin 500mg</div>
                  <div className="fine" style={{ marginTop: 'var(--space-2)' }}>
                    Capsule · 21 capsules
                  </div>
                  <p style={{ marginTop: 'var(--space-3)', color: 'var(--ink-muted)' }}>
                    One capsule, three times a day, after food — for seven days.
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
                  <span style={{ color: 'var(--ink-muted)' }}>Dispensed by {clinic}</span>
                  <span className="badge badge-good">
                    <Icon name="check" /> 3 of 3 collected
                  </span>
                </div>

                <p className="fine" style={{ marginTop: 'var(--space-4)' }}>
                  A sample layout, not a prescription. Only your clinician can prescribe.
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
            <span className="site-eyebrow">Questions</span>
            <h2 className="site-h2">The things people ask first.</h2>
          </div>

          <div className="faq">
            <details>
              <summary>What does it cost?</summary>
              <p>
                {clinic} sets the price, not Carevelo. You see the consultation fee before
                you approve any payment, and the price of any medicine before you agree to
                it. There is no charge for having an account and no subscription to keep it.
                Your mobile money provider may charge its own transaction fee, as it does
                for any payment you make.
              </p>
            </details>

            <details>
              <summary>Do I need a smartphone?</summary>
              <p>
                Not for all of it. The portal is an ordinary web page, so any phone with a
                browser can open it to book, to read a prescription and to see what you
                paid. A video consultation does need a smartphone and a connection that will
                carry it — and where it will not, the clinician can continue by voice or by
                typing. If you would rather not use a phone at all, {clinic} can still book
                you the way it always has.
              </p>
            </details>

            <details>
              <summary>What if the network drops in the middle of a consultation?</summary>
              <p>
                The consultation is built to fall back rather than fail: video drops to
                voice, and voice to typing, without starting again. If you lose the
                connection completely, open the same link and you return to the same
                consultation rather than a new one. If it cannot be recovered at all,{' '}
                {clinic} has your number and can reach you.
              </p>
            </details>

            <details>
              <summary>Who can see my records?</summary>
              <p>
                Staff at {clinic} who are involved in your care. No other clinic using
                Carevelo can reach them: the separation is enforced by the database itself
                rather than by a setting somebody could get wrong. Carevelo&apos;s own staff
                do not read patient records in the ordinary course of their work — support
                access is restricted and recorded. Nobody buys your data from us, because we
                do not sell it and it is not ours to sell.
              </p>
            </details>

            <details>
              <summary>What if I do not have an email address?</summary>
              <p>
                {/*
                 * The honest answer, and it is a no. Signing in is an email address and a
                 * password; the phone one-time-code flow is gone from the product and its
                 * endpoints are gone from the API. Papering over that with "contact us"
                 * would send a patient round a loop that has no exit, so this says plainly
                 * what to do instead — which is the thing that has always worked.
                 */}
                Then you cannot use this portal yet, and it is better to say so than to send
                you round in a circle. Signing in needs an email address and a password, and
                there is no code-by-text alternative. Ask {clinic} to book you by phone, as
                you always have — nothing here replaces being able to ring the clinic. If
                you do set up an email address later, {clinic} can create your account at the
                front desk and give you a temporary password to change.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* ---- Close ---- */}
      <section className="site-section site-section--tint">
        <div className="site-wrap">
          <div className="cta-band">
            <span className="site-eyebrow">Ready when you are</span>
            <h2>{clinic}, on your phone.</h2>
            <p>
              Sign in to book a consultation, read your prescription and keep every receipt
              in one place.
            </p>

            <div className="site-btn-row">
              {user ? (
                <Link className="btn btn-brand btn-lg" href="/account">
                  Go to my care
                </Link>
              ) : (
                <Link className="btn btn-brand btn-lg" href="/sign-in">
                  Sign in to {clinic}
                </Link>
              )}

              {tenant.contact?.phone ? (
                <a className="site-textlink" href={`tel:${tenant.contact.phone}`}>
                  <Icon name="phone" /> Or call {tenant.contact.phone}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
