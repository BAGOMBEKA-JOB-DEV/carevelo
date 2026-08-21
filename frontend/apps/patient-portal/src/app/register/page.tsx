import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { RegistrationForm } from '@/domains/patients'
import { SiteShell } from '@/components/SiteShell'

/**
 * Registering yourself with the clinic.
 *
 * THE ONE PATIENT-FACING ROUTE THAT A GUEST IS MEANT TO REACH. Every other screen behind
 * the header redirects a caller with no session to /sign-in; this one must not, because
 * the person filling it in does not have an account yet and creating one is the point.
 * That is also why there is no `currentUser()` gate below and no guest branch: absence of
 * a session is the normal case here, not a failure.
 *
 * A SIGNED-IN PATIENT IS SENT TO THEIR HUB instead of being shown the form. They are
 * already registered — the account they are holding was created against a patient record —
 * and a second self-registration would create the duplicate that
 * `PatientController::merge` exists to clean up afterwards. Better not to make it.
 *
 * WHERE THE FORM POSTS IS NOT DECIDED HERE. The submit is a Server Action inside
 * `RegistrationForm`, and the two paths it needs are passed in rather than hard-coded in
 * the domain: `returnHref` is this route (a rejected submission comes back to it with
 * `?error=` and `?field=`), and `consentHref` is where a created record goes next. The
 * patients domain owns no URL, so it cannot be talked into redirecting anywhere a form
 * body names.
 *
 * NO PATIENT IDENTIFIER TRAVELS BETWEEN THE TWO SCREENS IN THE URL. The domain puts it in
 * an httpOnly cookie; see domains/patients/api/handoff.ts for why. This route therefore
 * passes a bare path with no query of its own.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; field?: string }>
}) {
  const [tenant, user, params] = await Promise.all([
    resolveTenant(),
    currentUser(),
    searchParams,
  ])

  if (user) {
    redirect('/account')
  }

  return (
    <SiteShell tenant={tenant} signedIn={false}>
      <RegistrationForm
        tenant={tenant}
        returnHref="/register"
        consentHref="/consent"
        error={params.error}
        errorField={params.field}
      />
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
