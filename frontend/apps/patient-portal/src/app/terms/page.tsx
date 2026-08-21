import Link from 'next/link'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { SiteShell } from '@/components/SiteShell'

/**
 * The terms a patient is actually agreeing to by using the portal.
 *
 * IT EXISTS BECAUSE THE FOOTER LINKS TO IT, and because the single most important thing
 * on it — that this is not for an emergency — is worth a page of its own rather than a
 * line of small print somebody scrolls past.
 *
 * THE DIVISION OF RESPONSIBILITY IS THE WHOLE DOCUMENT. {clinic} provides the care and
 * carries the licence; Carevelo provides the software and never touches either. Every
 * section below is a consequence of that one sentence, including the uncomfortable ones:
 * we cannot refund a consultation, because the money never came to us.
 *
 * NOTHING LEGAL IS INVENTED. No statute, no registration number, no governing-law clause
 * pulled out of the air — where a clinic must state something the text says so plainly,
 * in the text, where a patient reads it.
 */
export default async function TermsPage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])
  const clinic = tenant.trading_name ?? 'this clinic'
  const contact = tenant.contact

  return (
    <SiteShell tenant={tenant} signedIn={Boolean(user)}>
      <div className="site-pagehero">
        <span className="site-eyebrow">Terms of use</span>
        <h1 className="site-h1">Using {clinic}&apos;s patient portal.</h1>
        <p className="site-lede">
          What you can expect from the clinic, what the portal does, and what it is not for.
        </p>
      </div>

      <div className="site-doc">
        <p className="updated">
          {clinic} should record the date it adopted these terms, and the date of any change
          to them.
        </p>

        <div className="notice notice-bad">
          <b>This portal is not for an emergency.</b> If someone is seriously unwell,
          bleeding heavily, struggling to breathe, or unconscious, do not wait for a
          consultation to be booked. Go to the nearest health facility
          {contact?.phone ? <>, or call {clinic} on {contact.phone}</> : null}.
        </div>

        <p className="lead">
          These terms cover the patient portal — the website you are reading this on. Using
          it means you accept them. Your care itself is between you and {clinic}, on
          whatever terms the clinic gives you.
        </p>

        <h2>Who provides what</h2>
        <p>
          <b>{clinic} provides the care.</b> It is a licensed private clinic, its clinicians
          are registered to practise, and every clinical decision — whether to consult, what
          to prescribe, what to dispense — is theirs.
        </p>
        <p>
          <b>Carevelo provides the software.</b> We build and run the portal for {clinic}.
          We do not employ clinicians, we do not review a prescription, and we have no view
          on your treatment. Nothing on this site is medical advice, and no part of it is a
          substitute for seeing someone.
        </p>

        <h2>Your account</h2>
        <p>
          You sign in with an email address and a password. The password is yours and should
          be known to nobody else — including anyone at {clinic}. If the clinic created your
          account and gave you a temporary password, the portal asks you to change it before
          it lets you do anything else, and that is deliberate.
        </p>
        <p>
          Handsets get shared in a household. Sign out when you have finished if the phone is
          not only yours, and tell {clinic} if you think someone else has been in your
          account.
        </p>
        <p>
          Book only for yourself, or for someone you are entitled to act for — your child, or
          an adult in your care. The portal records who booked and on whose behalf, because a
          consultation attributed to the wrong person is a clinical risk, not a clerical one.
        </p>

        <h2>Booking, and not turning up</h2>
        <p>
          A booking is confirmed by {clinic}, not by Carevelo. Cancellation notice, lateness
          and what happens to a fee if you miss an appointment are the clinic&apos;s own
          policy — <b>{clinic} should state that policy here</b>. Ask at the clinic and it
          will tell you.
        </p>

        <h2>Paying</h2>
        <p>
          {clinic} sets every price. You see the amount before you approve anything, and you
          approve it on your own phone with your mobile money provider. The money goes
          directly to the clinic&apos;s own account: Carevelo never receives it and never
          holds it.
        </p>
        <p>
          That has a consequence worth stating plainly. <b>Carevelo cannot refund you.</b> A
          refund is {clinic}&apos;s decision and {clinic}&apos;s payment to make, and asking
          us would only delay it. Your mobile money provider may charge its own transaction
          fee, which is between you and them.
        </p>

        <h2>Prescriptions, dispensing and delivery</h2>
        <p>
          A prescription is written by your clinician at {clinic} and dispensed by the
          clinic. What the portal shows you is a copy of what they wrote, so you can read it
          at your own pace rather than remember it.
        </p>
        <p>
          Some medicines are controlled and must be collected in person, with identification.
          Those are never sent out for delivery, by anyone, for any reason. Where delivery is
          available, {clinic} decides the area it covers and the charge for it.
        </p>

        <h2>When the portal is unavailable</h2>
        <p>
          We aim to keep it running and we do not promise it never stops. Networks fail,
          power fails, and software gets updated. If the portal is down, {clinic} is still
          there — telephone the clinic, as you would have before any of this existed. Nothing
          here replaces being able to ring your clinic, and it is not meant to.
        </p>

        <h2>Your records</h2>
        <p>
          Your consultation notes, prescriptions and receipts are held by {clinic} and are
          visible to the staff there involved in your care. No other clinic using Carevelo
          can reach them.{' '}
          <Link href="/privacy">The privacy notice</Link> sets out what is held, for how
          long, and how to ask for a copy.
        </p>

        <h2>Ending your use of the portal</h2>
        <p>
          You can stop using the portal at any time and ask {clinic} to close your account.
          Closing the account does not delete your medical records: the clinic is obliged to
          keep those for a set period, and it will tell you what that period is.
        </p>
        <p>
          {clinic} may suspend an account that is being used to impersonate somebody, to
          abuse its staff, or to interfere with the service. Losing access to the portal
          never means losing your care — the clinic remains reachable by phone and in person.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          If these terms change in a way that affects you, {clinic} will make the new version
          available here and date it. Continuing to use the portal after that means the new
          version applies.
        </p>

        <h2>Which law applies</h2>
        <p>
          {clinic} operates in Uganda and answers to the laws and professional regulators
          that govern private clinics there. <b>{clinic} should state the governing law and
          how a dispute is to be resolved here</b>; Carevelo cannot state it on the
          clinic&apos;s behalf, and would rather leave a gap the clinic fills than print a
          clause it never agreed to.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about your care, a booking, a price or a refund go to {clinic}.
          {contact?.phone ? (
            <>
              {' '}
              Call <b className="tnum">{contact.phone}</b>.
            </>
          ) : null}
          {contact?.email ? <> Write to {contact.email}.</> : null}
          {contact?.physical_address ? (
            <>
              {' '}
              Or visit {contact.physical_address}
              {contact.district ? `, ${contact.district}` : ''}.
            </>
          ) : null}
          {!contact?.phone && !contact?.email && !contact?.physical_address ? (
            <>
              {' '}
              {clinic} has not published contact details in the portal yet — ask at the
              clinic, and it can add them here.
            </>
          ) : null}
        </p>

        <p>
          <Link className="site-textlink" href="/privacy">
            Read the privacy notice →
          </Link>
        </p>
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
