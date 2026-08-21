import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { ConsultationScreen } from '@/domains/consultations'
import { SiteShell } from '@/components/SiteShell'

/**
 * The consultation: the lobby, the room, and every honest reason for neither.
 *
 * THE PATH IS NOT FREE. `consultationHref()` hard-codes `/consultations/{id}` because that
 * one URL is the `{join_link}` in the confirmation SMS, the address the front desk reads
 * down the telephone, and the link a patient opens again after their connection dropped.
 * "No app install; the join path is a link" only holds if there is exactly one of them, so
 * this directory name is part of the domain's contract rather than a routing preference.
 *
 * ONE COMPONENT, AND EVERYTHING ELSE BEHIND IT. Whether a booking may be entered — its
 * status, how long until it opens, the grace period after it ends, whether this browser has
 * already spent a join token — is business logic, and business logic in the routing tree is
 * logic nothing looks for. The route resolves the clinic, checks there is a session, and
 * renders. It does not read the appointment: `ConsultationScreen` does, and calls
 * `notFound()` for one that is not this patient's, whether it never existed, belongs to
 * someone else here, or belongs to another clinic entirely. There is no 403 branch to add,
 * and adding one would undo the isolation boundary the API is careful to hold.
 *
 * `?entry=` IS FORWARDED RAW. The enter action sets it when a press failed, and the domain
 * normalises it against a closed set — anything unrecognised renders as no error at all.
 * A route that interpreted it would be a second, drifting copy of that set, in the one
 * place where an unrecognised value comes straight from whoever wrote the link.
 *
 * `clinicianName` AND `emergencyGuidance` ARE DELIBERATELY NOT PASSED. `AppointmentResource`
 * carries `clinician_id` and no name, so supplying it would mean this route fetching the
 * clinician list for one string on a handset; the screens simply do not name them instead.
 * `TenantResource` has no emergency-guidance field yet, so the domain's own
 * clinic-attributed default wording stands — which is the wording H3 requires to be
 * persistent and identical wherever it appears.
 */
export default async function ConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ appointment: string }>
  searchParams: Promise<{ entry?: string }>
}) {
  const [tenant, user, { appointment }, query] = await Promise.all([
    resolveTenant(),
    currentUser(),
    params,
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx. A consultation is clinical content, and
  // this product shows clinical content in-app under authentication and nowhere else.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  return (
    <SiteShell tenant={tenant} signedIn>
      <ConsultationScreen tenant={tenant} appointmentId={appointment} entry={query.entry} />
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
