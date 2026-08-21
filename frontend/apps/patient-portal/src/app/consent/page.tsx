import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import {
  ConsentDeclined,
  ConsentScreen,
  currentConsentPolicy,
  readRegistrationHandoff,
} from '@/domains/patients'
import { SiteShell } from '@/components/SiteShell'

/**
 * The consent screen: the policy in full, and an affirmative tick against it.
 *
 * A GUEST IS EXPECTED HERE, exactly as on /register. A patient who has just registered
 * themselves has a patient RECORD and no account — `PatientAccountController` creates the
 * account afterwards — so requiring a session would lock the journey out of its own second
 * step. Authorisation is not weakened by that: every decision this screen posts is checked
 * by the API against whoever is calling, and a forged handoff reaches a 404 or a 401
 * exactly as a typed one would.
 *
 * WHICH RECORD IS BEING CONSENTED FOR COMES FROM A COOKIE, NEVER FROM THE URL. That is the
 * whole reason `readRegistrationHandoff()` exists, and the reason this route has no
 * `[patient]` segment: under the DPPA the bare fact that a named person is a patient of a
 * named clinic is special-category data, and an identifier in a path lands in browser
 * history on a shared handset, in the `Referer` of everything the page links to, and in
 * every access log in front of the portal. No handoff means the pointer expired or was
 * never made, and the honest answer is to start again rather than to ask somebody to
 * consent on behalf of a record this page cannot name.
 *
 * THE POLICY IS AWAITED HERE AND WILL THROW IF IT CANNOT BE READ, deliberately.
 * `currentConsentPolicy()` does not soften a failure into null, so there is no way for this
 * route to render a consent form with the text missing above it — which would be a form
 * collecting agreement to nothing. A thrown error becomes the error boundary; a
 * half-rendered consent screen would become a compliance incident.
 *
 * `?declined=1` IS ITS OWN SCREEN rather than a notice on this one. The decline action
 * redirects here with that flag, and what follows is not "try again" — the registration is
 * discarded and the patient is told plainly what that means and that they are still welcome
 * to be seen at the desk.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ declined?: string; error?: string }>
}) {
  const [tenant, handoff, params] = await Promise.all([
    resolveTenant(),
    readRegistrationHandoff(),
    searchParams,
  ])

  if (params.declined === '1') {
    return (
      <SiteShell tenant={tenant} signedIn={false}>
        <ConsentDeclined tenant={tenant} registerHref="/register" />
      </SiteShell>
    )
  }

  if (handoff === null) {
    redirect('/register')
  }

  // Fetched after the handoff check rather than beside it: there is no point spending a
  // round trip on a handset to read a policy for a registration this browser cannot name.
  const policy = await currentConsentPolicy()

  return (
    <SiteShell tenant={tenant} signedIn={false}>
      <ConsentScreen
        tenant={tenant}
        policy={policy}
        patientId={handoff.patientId}
        grantedBy={handoff.guardianRequired ? 'guardian' : undefined}
        decided={handoff.decided}
        returnHref="/consent"
        /*
         * WHERE THE JOURNEY GOES ONCE DATA PROCESSING IS AGREED. /account, which is the
         * patient's hub if they already have a session and redirects to /sign-in if they
         * do not — which is the correct destination for a self-registered patient, whose
         * account is created by the clinic and who signs in with it afterwards. Sending
         * them straight to /sign-in instead would be this route asserting that they have
         * no session, which it has no reason to assume.
         */
        continueHref="/account"
        error={params.error}
      />
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
