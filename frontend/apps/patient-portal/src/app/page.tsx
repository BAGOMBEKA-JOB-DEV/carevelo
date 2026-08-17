import Link from 'next/link'
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
 * @see docs/10-product/white-labeling-and-branding.md
 */
export default async function HomePage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])
  const clinic = tenant.trading_name ?? 'this clinic'
  const district = tenant.contact?.district

  return (
    <SiteShell tenant={tenant} signedIn={Boolean(user)}>
      {/* ---- Hero ---- */}
      <section className="site-hero">
        <div className="site-wrap site-hero__grid">
          <div>
            <span className="site-eyebrow">
              {district ? `${district} · Uganda` : 'Uganda'}
            </span>

            <h1 className="site-h1" style={{ marginTop: 'var(--space-5)' }}>
              See a clinician at {clinic} — without leaving home.
            </h1>

            <p className="site-lede">
              Book a consultation, speak to a clinician by video, voice or chat, pay with
              mobile money, and have your medicine brought to you. Your records stay with{' '}
              {clinic}.
            </p>

            <div className="site-btn-row" style={{ marginTop: 'var(--space-7)' }}>
              {user ? (
                <Link className="btn btn-brand btn-lg" href="/account">
                  Go to my care
                </Link>
              ) : (
                <>
                  <Link className="btn btn-brand btn-lg" href="/sign-in">
                    Book a consultation
                  </Link>
                  <Link className="btn btn-ghost btn-lg" href="/sign-in?method=code">
                    I have an account
                  </Link>
                </>
              )}
            </div>

            <div className="site-chips" style={{ marginTop: 'var(--space-7)' }}>
              <span className="site-chip">MTN &amp; Airtel money</span>
              <span className="site-chip">Works on any phone</span>
              <span className="site-chip">English &amp; Luganda</span>
            </div>
          </div>

          {/*
           * The proposition restated as the thing a patient actually gets. A product
           * screenshot would be the obvious thing here and would be a lie until booking
           * and consultations exist, so this is the honest version of the same panel.
           */}
          <div className="card card-brand">
            <span className="site-eyebrow">What you get</span>
            <ul style={{ marginTop: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
              <li>A consultation with a clinician registered at {clinic}.</li>
              <li>Your prescription, written and readable on your phone.</li>
              <li>Your medicine dispensed by the clinic and delivered to you.</li>
              <li>A receipt for every shilling, kept in one place.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className="site-section site-section--tint" id="how">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">How it works</span>
            <h2 className="site-h2" style={{ marginTop: 'var(--space-4)' }}>
              Four steps, start to medicine in hand.
            </h2>
            <p className="site-lede">
              Nothing to install and nothing to post. If you can send a text message, you can
              do all of this.
            </p>
          </div>

          <div className="site-steps">
            <div className="site-step">
              <h3>Book</h3>
              <p>
                Choose a clinician and a time that suits you. {clinic} confirms it on the
                spot.
              </p>
            </div>
            <div className="site-step">
              <h3>Pay</h3>
              <p>
                Approve the payment on your phone with MTN or Airtel money. The money goes to{' '}
                {clinic}.
              </p>
            </div>
            <div className="site-step">
              <h3>Consult</h3>
              <p>
                Speak to your clinician by video, by voice, or by typing if the network is
                poor.
              </p>
            </div>
            <div className="site-step">
              <h3>Collect</h3>
              <p>
                Read your prescription, then collect your medicine from {clinic} or have it
                brought to you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- What you can do ---- */}
      <section className="site-section" id="care">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">Your care</span>
            <h2 className="site-h2" style={{ marginTop: 'var(--space-4)' }}>
              Everything about your visit, in one place.
            </h2>
          </div>

          <div className="site-features">
            <div className="site-feature">
              <h3>Consult however the network allows</h3>
              <p>
                Video when the connection is good, voice when it is not, and typing when it is
                worse. The consultation does not fail because the signal did.
              </p>
            </div>
            <div className="site-feature">
              <h3>Read your own prescription</h3>
              <p>
                What was prescribed, how much of it, and how to take it — in writing, on your
                phone, for as long as you need it.
              </p>
            </div>
            <div className="site-feature">
              <h3>Follow your delivery</h3>
              <p>
                See when your medicine leaves {clinic} and when it is close. The rider is told
                where to go, never what is in the package.
              </p>
            </div>
            <div className="site-feature">
              <h3>Keep every receipt</h3>
              <p>
                Every payment you make to {clinic} is receipted and kept, so you can show what
                you paid and when.
              </p>
            </div>
            <div className="site-feature">
              <h3>Book for your family</h3>
              <p>
                A parent or guardian can book and consult on behalf of a child, with consent
                recorded properly.
              </p>
            </div>
            <div className="site-feature">
              <h3>Ask in your language</h3>
              <p>
                The portal reads in English and Luganda, and you choose which — including the
                consent you are asked to give.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Trust ---- */}
      <section className="site-section site-section--brand" id="trust">
        <div className="site-wrap">
          <div className="site-sec-head">
            <span className="site-eyebrow">Safety and privacy</span>
            <h2 className="site-h2" style={{ marginTop: 'var(--space-4)' }}>
              Your clinic. Your records. Your money.
            </h2>
          </div>

          <div className="site-features">
            <div className="site-feature">
              <h3>Care from a licensed clinic</h3>
              <p>
                {clinic} is a licensed private clinic, and the clinician you speak to is
                registered to practise. Carevelo provides the software — never the care, and
                never the diagnosis.
              </p>
            </div>
            <div className="site-feature">
              <h3>Payment goes to the clinic</h3>
              <p>
                {/*
                 * Load-bearing, and not marketing. Carevelo never holds patient money;
                 * saying so here is the promise the payments architecture actually keeps.
                 */}
                Money moves from you to {clinic}. Carevelo never holds it, never keeps a
                balance for you, and cannot take anything out of your account.
              </p>
            </div>
            <div className="site-feature">
              <h3>Only your clinic sees your records</h3>
              <p>
                Your consultation notes and prescriptions belong to {clinic} and are visible to
                its own clinicians. No other clinic on Carevelo can reach them.
              </p>
            </div>
          </div>

          {!user ? (
            <div className="site-btn-row" style={{ marginTop: 'var(--space-8)' }}>
              <Link className="btn btn-brand btn-lg" href="/sign-in">
                Sign in to {clinic}
              </Link>
              {tenant.contact?.phone ? (
                <a className="site-textlink" href={`tel:${tenant.contact.phone}`}>
                  Or call {tenant.contact.phone} →
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </SiteShell>
  )
}
