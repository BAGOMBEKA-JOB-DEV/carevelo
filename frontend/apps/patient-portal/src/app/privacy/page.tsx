import Link from 'next/link'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { SiteShell } from '@/components/SiteShell'

/**
 * The clinic's privacy notice.
 *
 * IT EXISTS BECAUSE THE FOOTER LINKS TO IT. A footer with a dead "Privacy" link is worse
 * than a footer with none: it tells a patient there is a notice and then does not produce
 * one, which is the impression this page is here to prevent.
 *
 * WRITTEN FOR THE PATIENT, NOT FOR A REGULATOR. Plain sentences, short sections, and the
 * questions in the order somebody actually asks them: who has my information, who can see
 * it, how long is it kept, how do I get a copy.
 *
 * NOTHING LEGAL IS INVENTED. No statute is cited by name and year, no registration number
 * is quoted, and no data protection officer is named, because this file has no way to know
 * any of them and a confidently wrong citation in a clinic's own privacy notice is a real
 * liability rather than a typo. Where a clinic must supply something the text says so, in
 * the text, where a patient reads it — not in a comment where only we would.
 *
 * THE CONTROLLER/PROCESSOR SPLIT IS THE ONE PIECE OF JARGON KEPT, because it is the fact
 * that determines who a patient complains to, and it is explained in the sentence that
 * uses it.
 */
export default async function PrivacyPage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])
  const clinic = tenant.trading_name ?? 'this clinic'
  const contact = tenant.contact

  return (
    <SiteShell tenant={tenant} signedIn={Boolean(user)}>
      <div className="site-pagehero">
        <span className="site-eyebrow">Privacy</span>
        <h1 className="site-h1">How {clinic} handles your information.</h1>
        <p className="site-lede">
          What is held about you, who can see it, how long it is kept, and how to ask for a
          copy or a correction.
        </p>
      </div>

      <div className="site-doc">
        <p className="updated">
          {clinic} should record the date it adopted this notice, and the date of any change
          to it.
        </p>

        <p className="lead">
          This notice covers the patient portal you are reading it on. It is written by
          Carevelo, which supplies the software, and it describes what {clinic} does with
          your information when you use it. {clinic} may hold information about you outside
          the portal as well — on paper, or in a book at the front desk — and that is
          covered by whatever the clinic tells you directly.
        </p>

        <h2>Who is responsible for your information</h2>
        <p>
          <b>{clinic} is.</b> In data protection language the clinic is the{' '}
          <b>data controller</b>: it decides what is collected about you and what happens to
          it, and it is the one you ask, correct or complain to.
        </p>
        <p>
          <b>Carevelo is the processor.</b> We hold and move the information on the
          clinic&apos;s behalf and on its instructions. We do not decide what happens to it,
          we do not use it for our own purposes, and we do not sell it — to anyone, for any
          price. If you ask us directly for your records we will refer you to {clinic},
          because it is not ours to hand over.
        </p>

        <h2>What is held</h2>
        <ul>
          <li>
            <b>Who you are.</b> Your name, your phone number, the email address you sign in
            with, and whatever else {clinic} records to identify you as its patient.
          </li>
          <li>
            <b>Your care.</b> Consultations you book and attend, what your clinician records
            during them, what is prescribed, and what is dispensed or delivered to you.
          </li>
          <li>
            <b>Your payments.</b> What you were charged, what you paid, when, and the
            reference the mobile money provider returned. Not your PIN, and not your mobile
            money account credentials — those never reach the portal.
          </li>
          <li>
            <b>How you used the portal.</b> Sign-ins and significant actions are logged, so
            that unauthorised access to your records can be detected and investigated. That
            log is a safety measure, not a profile.
          </li>
        </ul>

        <h2>Who can see it</h2>
        <ul>
          <li>
            <b>You.</b> Whatever the portal shows you is yours to read for as long as your
            account exists.
          </li>
          <li>
            <b>Staff at {clinic} involved in your care.</b> Clinicians, pharmacy staff and
            the people who run the clinic&apos;s books see what their work requires.
          </li>
          <li>
            <b>Nobody at another clinic.</b> Every clinic using Carevelo is separated in the
            database itself, so a clinic that is not yours cannot reach your records even by
            mistake.
          </li>
          <li>
            <b>Carevelo&apos;s staff, rarely and on the record.</b> Support and engineering
            access to live patient data is restricted, requires a reason, and is logged.
            Nobody here browses records out of curiosity, and there is a record if they try.
          </li>
          <li>
            <b>Your delivery rider, and only where to go.</b> A rider bringing medicine to
            you is given the address and the fact there is a package. Not what is in it, and
            not why you were prescribed it.
          </li>
        </ul>

        <h2>Your payments</h2>
        <p>
          Money moves from you to {clinic} through the clinic&apos;s own mobile money
          account. Carevelo never receives it and never holds it, which also means we never
          hold the account details it came from — your mobile money provider does, and its
          own privacy terms cover that.
        </p>

        <h2>How long it is kept</h2>
        <p>
          Your medical records are kept for as long as {clinic} is required to keep them.
          That period is set by the clinic and by the rules it practises under, not by
          Carevelo — <b>{clinic} should state its retention period here</b>, and will tell
          you what it is if you ask. Records are not deleted simply because you stop using
          the portal: a clinic that destroyed a patient&apos;s notes on request would be
          failing a different obligation.
        </p>
        <p>
          Payment records are kept for as long as the clinic&apos;s accounting and tax
          obligations require. Sign-in logs are kept for a limited period and then removed.
        </p>

        <h2>Asking for a copy, or a correction</h2>
        <p>
          You can ask {clinic} for a copy of what it holds about you, and you can ask it to
          correct anything that is wrong — a misspelled name, the wrong date of birth, a
          phone number that belongs to somebody else. Ask the clinic directly, using the
          contact details below.
        </p>
        <p>
          A clinical note cannot simply be deleted because you disagree with it, but you can
          ask for your disagreement to be recorded alongside it. That is the honest position
          rather than the comfortable one.
        </p>

        <h2>Cookies and your browser</h2>
        <p>
          Signing in sets one cookie, which is how the portal knows the next page you open
          is still you. It is not used to follow you anywhere else, and signing out ends it.
          Your choice of light or dark theme is stored in your own browser and never sent to
          us. There are no advertising or tracking scripts on this portal, and there cannot
          be: the site&apos;s content security policy refuses to load a script from anywhere
          but this clinic&apos;s own address.
        </p>

        <h2>If something goes wrong</h2>
        <p>
          Tell {clinic} first — it is the controller, and it can act. If you are not
          satisfied with the answer you can complain to the authority that supervises data
          protection in Uganda; <b>{clinic} should name that authority and its address
          here</b>, along with the person at the clinic who handles these questions.
        </p>
        <p>
          If a breach affects your information, {clinic} is the one who must tell you.
          Carevelo&apos;s obligation is to tell {clinic}, promptly and in full, and we treat
          that as a duty to the patient rather than a courtesy to a customer.
        </p>

        <h2>Contact</h2>
        <p>
          {contact?.phone ? (
            <>
              Call {clinic} on <b className="tnum">{contact.phone}</b>.{' '}
            </>
          ) : null}
          {contact?.email ? <>Write to {contact.email}. </> : null}
          {contact?.physical_address ? (
            <>
              Or visit {contact.physical_address}
              {contact.district ? `, ${contact.district}` : ''}.
            </>
          ) : null}
          {!contact?.phone && !contact?.email && !contact?.physical_address ? (
            <>
              {clinic} has not published contact details in the portal yet. Ask at the
              clinic, and it can add them here.
            </>
          ) : null}
        </p>

        <p>
          <Link className="site-textlink" href="/terms">
            Read the terms of use →
          </Link>
        </p>
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
