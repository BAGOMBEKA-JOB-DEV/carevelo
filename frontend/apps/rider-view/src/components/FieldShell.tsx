import type { ReactNode } from 'react'
import { Stack, ThemeToggle } from '@carevelo/ui'
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
 * IF YOU OPEN THIS ON A LAPTOP AND SEE NO TABS, that WAS layout.css: `.tabbar` is
 * `display: none` above 900px, because on the console it is the small-screen substitute
 * for a sidebar. This surface has no sidebar to substitute for, so above 900px it had no
 * navigation at all — no route to "Completed", no way back from a delivery, and nothing
 * carrying `aria-current`. Harmless for the device this app is built for and wrong in
 * principle, since keyboard reachability is not conditional on a viewport width. `rider.css`
 * now puts the tab bar back above 900px, scoped to this frame; the correction belongs in
 * layout.css beside the rule it corrects, and that file is in packages/ui.
 *
 * THE MAIN COLUMN IS A `Stack`, WHICH IS WHY NO PAGE IN THIS APP SETS A MARGIN ANY MORE.
 * Every route renders two or three siblings into it — a screen, sometimes an access notice,
 * and the sign-out row — and each of those used to be responsible for the space above
 * itself. `SignOutButton` carried `marginTop: var(--space-7)` for exactly that reason, which
 * meant the gap between the round and the sign-out row was decided by the sign-out row,
 * while the gap above the round was decided by nothing. One `gap` on the column is one
 * decision, and it cannot be got wrong by inserting a sibling.
 *
 * THE THEME TOGGLE IS THIS APP'S FIRST CLIENT COMPONENT, AND IT IS ALSO THE ONLY ONE.
 * The dark palette in colors.css has never rendered on this surface: the tokens existed,
 * the bootstrap script did not, and there was no control to set the preference. All three
 * arrive together, because any two of them without the third is a feature nobody can reach.
 * The button itself is the shared `<ThemeToggle>` — its whole job is to write to browser
 * storage, which is the one thing a server component cannot do, and it is the single
 * 'use client' in packages/ui for exactly that reason. Note what this costs and what it does
 * not: the paragraph above says this surface ships no client JavaScript, and that is no
 * longer strictly true. It ships this one button, and nothing else changed.
 *
 * It is worth that on the surface where a needless client bundle is paid for by a rider on a
 * mid-range Android phone, because this is also the only surface in the product that is read
 * OUTDOORS. Sunlight wants the light theme and a delivery at 8pm wants the dark one, and the
 * same rider has both within a shift. A theme that cannot be changed from the device is, on
 * this app, the same as no theme at all.
 *
 * It sits in the topbar and comes LAST in the markup, which is last in the tab order: the
 * theme is the least urgent thing on this screen and must not sit between a rider — or a
 * keyboard user — and the delivery they opened the page for.
 */
export function FieldShell({ active, children }: { active: SectionId | null; children: ReactNode }) {
  return (
    <div className="fieldview">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <span className="topbar__title">Deliveries</span>
        <span className="topbar__spacer" />
        <ThemeToggle />
      </header>

      <main className="fieldview__main" id="main">
        <Stack gap="7">{children}</Stack>
      </main>

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
