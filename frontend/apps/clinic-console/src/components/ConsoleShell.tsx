import type { ReactNode } from 'react'
import { ThemeToggle } from '@carevelo/ui'
import { SECTION_IDS, SECTIONS, type SectionId } from './sections'

/**
 * ConsoleShell — the clinic console frame.
 *
 * Carevelo branding, with the clinic's logo in the header: staff know they use
 * Carevelo, and the clinic is the customer rather than the audience.
 *
 * aria-current on the active item, not only a colour and a bar. Colour alone fails a
 * colour-blind user and says nothing to a screen reader.
 *
 * `active` IS REQUIRED AND MAY BE NULL, which is the whole fix. It used to be optional,
 * the root layout rendered this shell and never passed it, and a layout is not told which
 * route is rendering inside it — so the condition below could not be true for any page,
 * ever. Six nav links, none of which could be current, and no way to tell from the code
 * that the highlighting was decorative. Requiring the prop means a new page has to say
 * where it is; `null` is how a page that is not a nav section says so out loud, rather
 * than by omission.
 *
 * WHICH IS WHY THE PAGES RENDER THIS, NOT THE LAYOUT. The patient portal already works
 * this way and says why in SiteShell: the frame is applied by the pages that want it.
 * Here the reason is narrower — only the page knows which section it is — and it costs
 * nothing, because the nav is plain <a> elements and every navigation is a document load
 * regardless. No usePathname and no JavaScript to decide where you are.
 *
 * THE THEME TOGGLE IS THIS APP'S FIRST CLIENT COMPONENT, AND IT IS ALSO THE ONLY ONE.
 * `--sidebar-bg: #151816` and the rest of the dark palette were written for this console
 * and had never rendered here: the tokens existed, the bootstrap script did not, and there
 * was no control to set the preference. All three arrive together, because any two of them
 * without the third is a feature nobody can reach. The button itself is the shared
 * `<ThemeToggle>` — its whole job is to write to browser storage, which is the one thing a
 * server component cannot do, and it is the single 'use client' in packages/ui for exactly
 * that reason. Everything else on this surface still renders on the server.
 *
 * It sits in the topbar rather than the sidebar because the sidebar is `display: none`
 * below 900px, and a clinician working between rooms on a phone is the person most likely
 * to be in a badly lit place. It comes LAST in the header's markup, which is last in the
 * tab order: the theme is the least urgent thing on this screen and should not sit between
 * a keyboard user and the page.
 *
 * The two navs are the same list rendered twice: the sidebar above 900px, the tab bar
 * below it. They read SECTIONS so they cannot drift apart from each other, from the
 * screens behind them, or from the routes under src/app.
 */
export function ConsoleShell({
  title,
  active,
  logoUrl,
  children,
}: {
  title: string
  active: SectionId | null
  logoUrl?: string | null | undefined
  children: ReactNode
}) {
  return (
    <div className="layout">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="sidebar">
        <div className="sidebar__brand">
          <strong>Carevelo</strong>
        </div>
        <nav className="sidebar__nav" aria-label="Sections">
          <div className="nav-group">
            {SECTION_IDS.map((id) => (
              <a
                key={id}
                href={SECTIONS[id].href}
                className={`nav-item${id === active ? ' is-active' : ''}`}
                aria-current={id === active ? 'page' : undefined}
              >
                {SECTIONS[id].label}
              </a>
            ))}
          </div>
        </nav>
      </aside>

      <div>
        <header className="topbar">
          <span className="topbar__title">{title}</span>
          <span className="topbar__spacer" />
          {logoUrl ? (
          /*
           * A plain <img>, deliberately. next/image would route a TENANT-UPLOADED
           * asset through Next's optimiser: more client JS on a surface with a 150KB
           * budget, and a second cache layer over an image the backend already
           * validated for format and dimensions, stripped of metadata, re-encoded and
           * served from tenant-partitioned storage. Nothing is left for the optimiser
           * to do except add weight. Height is capped in CSS so a tall logo cannot
           * push the header open.
           */
          // eslint-disable-next-line @next/next/no-img-element
            <img className="topbar__logo" src={logoUrl} alt="" />
          ) : null}
          <ThemeToggle />
        </header>
        <main className="content" id="main">{children}</main>
        <nav className="tabbar" aria-label="Sections">
          {SECTION_IDS.map((id) => (
            <a
              key={id}
              href={SECTIONS[id].href}
              className={id === active ? 'is-active' : undefined}
              aria-current={id === active ? 'page' : undefined}
            >
              {SECTIONS[id].label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  )
}
