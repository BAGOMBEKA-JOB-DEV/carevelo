import type { ReactNode } from 'react'
import { SECTION_IDS, SECTIONS, type SectionId } from './sections'

/**
 * ControlPlaneShell — the platform admin frame.
 *
 * Carevelo's own surface. Reaches no clinical data without an audited break-glass
 * grant, so the chrome deliberately looks like an internal tool rather than a
 * clinical one.
 *
 * aria-current on the active item, not only a colour and a bar. Colour alone fails a
 * colour-blind user and says nothing to a screen reader.
 *
 * `active` IS REQUIRED AND MAY BE NULL, which is the fix rather than a tidy-up. It was
 * optional, the root layout rendered this shell and never passed it, and a layout is not
 * told which route is rendering inside it — so no nav item could ever be current, and
 * because nothing was ever highlighted there was no way to notice from the running product
 * that all three links 404'd. Requiring the prop makes a page state where it is; `null` is
 * how a page that is not a nav section says so out loud rather than by omission.
 *
 * WHICH IS WHY THE PAGES RENDER THIS, NOT THE LAYOUT. Only the page knows its section, and
 * moving the frame down costs nothing: the nav is plain <a> elements, so every navigation
 * is a document load regardless, and this surface ships no client JavaScript at all. The
 * patient portal applies its frame from the pages too, for its own reasons; see SiteShell
 * there.
 *
 * The two navs are the same list rendered twice — the sidebar above 900px, the tab bar
 * below it — so they cannot drift apart from each other or from the screens behind them.
 */
export function ControlPlaneShell({
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
