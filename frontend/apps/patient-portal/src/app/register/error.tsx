'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../error'

/**
 * Registration failed, and the thing to prevent is a second attempt.
 *
 * A DUPLICATE PATIENT RECORD IS NOT A TIDINESS PROBLEM. The clinic console carries a whole
 * screen for merging them — `domains/patients/components/MergeScreen` — and that screen's
 * own copy says there is no way back from a merge. Until somebody performs one, a patient
 * with two records has their care split across both: a prescription on one, a consent
 * decision on the other, a payment against the third-party reference of whichever the front
 * desk happened to open. Every one of those is a clinical safety problem that started with
 * a form that appeared not to work.
 *
 * And this screen genuinely cannot tell whether it worked. `registerPatient` runs as a
 * Server Action; a page that throws while being put together afterwards throws no light on
 * whether the write landed. So the copy does not say "try again" and it does not reassure.
 * It says: do not fill it in twice, and telephone the clinic to ask whether they have you.
 *
 * "I already have an account" IS OFFERED BESIDE THE RETRY FOR A REASON. The commonest way a
 * second registration is created is by somebody who is already registered and does not know
 * it — so the sign-in route is on this screen, at the moment they are deciding.
 *
 * THIS BOUNDARY ALSO COVERS /consent, WHICH IS A SEPARATE FILE BECAUSE THE SEGMENTS ARE
 * SIBLINGS RATHER THAN NESTED. Both are steps of one registration and both share these
 * words; see consent/error.tsx.
 *
 * NOTHING PERSONAL APPEARS HERE. This component cannot reach the form's contents, and
 * `error.message` — which on this route can carry a name, a telephone number or a
 * validation sentence about either — is never rendered. See app/error.tsx for the whole
 * rule, and for why `error.digest` is the one exception to it.
 */
export default function RegisterError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="registration" error={error} reset={reset} />
}
