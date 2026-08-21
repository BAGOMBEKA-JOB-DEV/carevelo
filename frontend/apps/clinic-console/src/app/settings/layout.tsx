import type { ReactNode } from 'react'
import { ConsoleShell } from '@/components/ConsoleShell'
import { getClinic } from '@/domains/tenant'

/**
 * The frame around every settings screen.
 *
 * ------------------------------------------------------------------------------
 * WHY A LAYOUT HERE, WHEN THE OTHER CONSOLE SCREENS RENDER THE SHELL THEMSELVES.
 *
 * `ConsoleShell` requires `active`, and the pages render it because a layout is not told
 * which route is rendering inside it — that is the fix documented in `ConsoleShell.tsx`,
 * and it is not being undone. It simply does not bite here: EVERY route in this subtree is
 * the `settings` section, so the value a layout could not guess is a constant.
 *
 * What that buys is one fetch instead of eight. The clinic's logo in the console header is
 * the same image on all seven screens; fetched per page it would be seven round trips for a
 * header image on a surface a clinic administrator moves through quickly.
 *
 * ------------------------------------------------------------------------------
 * THE LOGO IS ALLOWED TO BE MISSING, AND THAT INCLUDES BEING UNREADABLE.
 *
 * `getClinic()` throws on 401 and 403, and this layout wraps every screen that exists to
 * EXPLAIN a 401 or a 403. Letting it throw would replace those explanations with the
 * framework's error boundary, which tells an administrator nothing — so a failure here is a
 * header with no logo, and the screen inside says what actually happened.
 *
 * The title is deliberately the section name for all seven. Next composes it with the
 * template in the root layout, and each screen carries its own heading and its own
 * `<h2>` — a tab title that changed on every sub-screen would be a second, competing
 * navigation.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const logoUrl = await clinicLogo()

  return (
    <ConsoleShell title="Settings" active="settings" logoUrl={logoUrl}>
      <div className="page-head">
        <div className="grow">
          <h1>Settings</h1>
          <p>
            Everything about this clinic that Carevelo does not decide: how it looks to
            patients, what it offers, when it opens, who works here, and where its money
            goes.
          </p>
        </div>
      </div>

      {children}
    </ConsoleShell>
  )
}

/** The clinic's logo, or nothing. Never an exception — see above. */
async function clinicLogo(): Promise<string | null> {
  try {
    const clinic = await getClinic()

    return clinic.branding.logo_url
  } catch {
    return null
  }
}
