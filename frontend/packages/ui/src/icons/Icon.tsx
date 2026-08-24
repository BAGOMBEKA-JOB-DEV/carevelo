import type { ReactElement, ReactNode } from 'react'

/**
 * The icon set — one 24×24 geometry, ported from the reference design system.
 *
 * WHY A RECORD OF JSX AND NOT A RECORD OF STRINGS
 *
 * The reference stores each icon as an HTML string and renders it with Vue's `v-html`.
 * The direct translation is `dangerouslySetInnerHTML`, and that is the translation this
 * file exists to refuse. This surface renders a patient's own health information under a
 * CSP with no `unsafe-inline` for scripts; introducing an innerHTML sink for decoration
 * would spend a real security control on a chevron. JSX fragments cost nothing extra,
 * React escapes by construction, and there is then no sink in the package at all.
 *
 * WHY IT IS A SERVER COMPONENT
 *
 * No 'use client', no hooks, no handlers. An icon is a shape; it has no state and no
 * behaviour, so it renders to markup on the server and ships zero client JavaScript.
 * The booking path has a hard 150KB first-load budget on a mid-range Android phone over
 * mobile data — a client-side icon component would put all 24 shapes, plus a component,
 * plus its share of the runtime, on the wrong side of that budget for no gain.
 *
 * WHY THE NAMES ARE A TYPE
 *
 * `IconName` is derived FROM the record rather than declared alongside it, so the two
 * cannot drift: `<Icon name="calender" />` is a compile error, not a silently empty
 * 24×24 box that nobody notices until a clinic does.
 *
 * The geometry is uniform on purpose — 24-unit box, `fill: none`, `stroke: currentColor`
 * at 1.7, round caps and joins. Icons that disagree about stroke weight read as icons
 * from different products, which on a white-label surface is exactly the wrong signal.
 * `currentColor` is what lets one set serve a clinic's brand colour, the ink colour and
 * an inverted button without a second file.
 */
const SHAPES = {
  /* ---- Ported verbatim from the reference set, so the two products stay one system ---- */
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="9" cy="6" rx="6" ry="3" />
      <path d="M3 6v6c0 1.7 2.7 3 6 3s6-1.3 6-3" />
      <path d="M15 11.5c2.5.3 6 1.4 6 3.5 0 1.7-2.7 3-6 3s-6-1.3-6-3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14v9.5H3z" />
      <path d="M14 8.5h3.4a2 2 0 0 1 1.7 1l1.9 3v2H14z" />
      <circle cx="7" cy="17.5" r="1.7" />
      <circle cx="17" cy="17.5" r="1.7" />
      <path d="M5 17.5h.4M9 17.5h6" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.85" />
      <path d="M16 3.1A4 4 0 0 1 16 11" />
    </>
  ),
  /*
   * FOUR DIRECTIONS, because for a long time there was only one.
   *
   * `chev` points DOWN, and it was the only chevron in the set — so every "go to this
   * page", "previous day" and "next day" affordance across all four apps reused it. A
   * downward chevron means "this expands"; pointing it at a link tells the reader the
   * card is about to unfold in place, and then the page navigates instead. Small, and it
   * was on the primary action of every card in the patient portal.
   *
   * `arrowRight` is for "go" — it carries motion, which a chevron does not, and it is what
   * the reference product uses in its own call-to-action links. `chevLeft`/`chevRight` are
   * for stepping through a sequence, where the pair reads as one control.
   */
  chev: <path d="m6 9 6 6 6-6" />,
  chevUp: <path d="m18 15-6-6-6 6" />,
  chevLeft: <path d="m15 18-6-6 6-6" />,
  chevRight: <path d="m9 18 6-6-6-6" />,
  arrowRight: (
    <>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M20 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8z" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  ext: <path d="M14 4h6v6M20 4l-9 9M19 13v6H5V5h6" />,
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.5" />
      <path d="M12 17h.01" />
    </>
  ),

  /* ---- Drawn here, in the same geometry, because the reference has no need of them.
         A waste-collection product ships a truck and a bin; a clinic needs to show a
         patient a phone number, an email address, a locked record and a heart. ---- */
  phone: (
    <path d="M4 5.2A1.7 1.7 0 0 1 5.7 3.5h2.4a1.2 1.2 0 0 1 1.2 1l.6 2.8a1.2 1.2 0 0 1-.6 1.3l-1.5.8a12.4 12.4 0 0 0 5.4 5.4l.8-1.5a1.2 1.2 0 0 1 1.3-.6l2.8.6a1.2 1.2 0 0 1 1 1.2v2.4a1.7 1.7 0 0 1-1.7 1.7A15 15 0 0 1 4 5.2z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.8 6.6 8.2 6 8.2-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.6v2.4" />
    </>
  ),
  heart: (
    <path d="M12 20.4C12 20.4 3.6 15.6 3.6 9.7a4.6 4.6 0 0 1 8.4-2.4 4.6 4.6 0 0 1 8.4 2.4c0 5.9-8.4 10.7-8.4 10.7z" />
  ),
} satisfies Record<string, ReactNode>

/**
 * Every icon this product has. Derived from the record, so it is impossible for the
 * union and the shapes to disagree.
 */
export type IconName = keyof typeof SHAPES

export type IconProps = {
  name: IconName
  /** Rendered size in px, square. 18 matches `.ico` in the reset. */
  size?: number | undefined
  className?: string | undefined
}

/**
 * The shared `<svg>` wrapper. Everything that must be identical across the set — the
 * box, the stroke, the caps — lives here exactly once, so no individual icon can drift.
 *
 * `aria-hidden` is unconditional and deliberate. An icon carries no meaning a screen
 * reader can use, and the alternative — a `title` prop — invites a label that duplicates
 * the visible text beside it, which reads out twice. Where an icon is the ONLY content of
 * a control, give the control the name: a `.sr-only` span (see reset.css) or an
 * `aria-label` on the button itself, where the accessibility tree expects it.
 *
 * Inside a flex row, pass `className="ico"` so the icon cannot be squeezed by a long
 * label beside it.
 *
 * @example
 * <span className="row"><Icon name="clock" /> 10:30</span>
 * <button aria-label="Close"><Icon name="x" /></button>
 */
export function Icon({ name, size = 18, className }: IconProps): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  )
}
