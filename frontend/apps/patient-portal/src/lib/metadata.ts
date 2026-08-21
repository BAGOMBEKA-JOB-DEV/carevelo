import type { Metadata } from 'next'
import { tryResolveTenant } from '@/lib/tenant'

/**
 * The page title, which is the CLINIC's name.
 *
 * WHY EVERY PAGE EXPORTS THIS INSTEAD OF THE ROOT LAYOUT. Resolving the tenant means a
 * `fetch`, and a fetch in the ROOT LAYOUT — including in its `generateMetadata` — poisons
 * the render Next performs when a Server Action calls `redirect()`. Measured on the
 * production build: one sign-in submission allocated ~800MB, the RSC stream closed early,
 * the browser never navigated, and three submissions took the server past 2.5GB and into
 * the OOM reaper. Deleting this one call from the layout took the same three submissions
 * from 2.5GB to 131MB and made the redirect work.
 *
 * The same fetch from a PAGE is fine — `/account` resolves the tenant and the session on
 * exactly the render that used to explode. So the work moved down one level rather than
 * being given up: each page exports `generateMetadata = clinicMetadata` and gets the same
 * title, and the root layout no longer touches the network at all.
 *
 * A patient switching tabs should see their clinic, not ours.
 */
export async function clinicMetadata(): Promise<Metadata> {
  const tenant = await tryResolveTenant()

  return {
    // An unknown host resolves to no clinic, and the title must not hint at what this
    // server is or whose clinics are on it.
    title: tenant?.trading_name ?? 'Not available',
    // Not indexable: a clinic's patient portal is not a public web page, and its existence
    // is the clinic's commercial information.
    robots: { index: false, follow: false },
  }
}
