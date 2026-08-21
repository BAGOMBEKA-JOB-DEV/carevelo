import type { ReactNode } from 'react'
import { SECTION_IDS, SECTIONS, type SectionId } from './sections'

/**
 * FieldShell — the rider view frame.
 *
 * The most restricted surface in the product. One column, no sidebar, nothing to get
 * lost in: the rider sees their own assignments and changes a status, and that is
 * the whole of it.
 *
 * NO CLINICAL DATA REACHES HERE, and the app carries only the delivery and identity
 * domains so that a prescribing form or a clinical note component cannot exist in
 * this bundle at all -- the frontend mirror of RiderDeliveryResource being a
 * separate class rather than the dispatcher's with fields hidden.
 *
 * aria-current on the active item, not only a colour and a bar. Colour alone fails a
 * colour-blind user and says nothing to a screen reader.
 *
 * `active` IS REQUIRED AND MAY BE NULL, which is the fix rather than a tidy-up. It was
 * optional, the root layout rendered this shell and never passed it, and a layout is not
 * told which route is rendering inside it — so neither tab could ever be current and the
 * highlighting was decoration. Requiring the prop makes a page state where it is; `null`
 * is how a page that is not one of the tabs says so out loud rather than by omission.
 *
 * That is also why the PAGES render this frame now and the layout does not. It costs
 * nothing here: the tabs are plain <a> elements, so every tap is a document load anyway,
 * and this surface stays entirely server-rendered — a rider on a mid-range Android phone
 * on a patchy connection is exactly who a needless client bundle is paid for by.
 *
 * IF YOU OPEN THIS ON A LAPTOP AND SEE NO TABS, that is layout.css: `.tabbar` is
 * `display: none` above 900px, because on the console it is the small-screen substitute
 * for a sidebar. This surface has no sidebar to substitute for, so above 900px it has no
 * navigation at all. Harmless for the device this app is built for and wrong in principle;
 * the rule lives in packages/ui, which this change does not own.
 */
export function FieldShell({ active, children }: { active: SectionId | null; children: ReactNode }) {
  return (
    <div className="fieldview">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <span className="topbar__title">Deliveries</span>
      </header>

      <main className="fieldview__main" id="main">{children}</main>

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
  )
}
