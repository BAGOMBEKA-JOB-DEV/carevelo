import type { ReactElement, ReactNode } from 'react'

/**
 * The content column of a signed-in patient page: the site's measure, and the air above
 * and below it.
 *
 * THE COUNT THIS RETIRES: 24 copies of `<div className="site-wrap" style={{ paddingBlock:
 * 'var(--space-8)' }}>` — by a distance the most-repeated inline style in this app, and
 * the clearest example of the thing the layout sweep was called for. The token was right
 * every one of those 24 times. There was simply nowhere to put it, so it went in a style
 * attribute, 24 times, where 24 chances existed to type `--space-7` by mistake.
 *
 * WHY IT LIVES HERE AND NOT IN packages/ui
 *
 * `.site-wrap` is the patient surface's measure — 1280px and a 24px gutter, tapering to
 * 18px below 480px — and the marketing chrome it belongs to is this app's alone. The
 * console, the rider view and the platform console have their own shells and would never
 * import this. frontend/README.md draws that line: packages/ui is what more than one app
 * needs, and apps/<app>/src/components/ is what one app needs. This is the second kind.
 *
 * WHY THE PADDING IS STILL AN INLINE STYLE, AND WHY THAT IS THE HONEST ANSWER
 *
 * Stack, Inline and Grid decide the space BETWEEN things. This is the space AROUND them —
 * padding on a wrapper — and no primitive in the layer models it, correctly: a padding
 * prop on Stack would be the beginning of a utility framework, and the layer is
 * deliberately not one. The alternative was a `.site-page` rule in tokens/site.css, which
 * is the right long-term home; it is in packages/ui, this sweep does not own that file,
 * and inventing a second mechanism in the app to avoid one style property would be worse
 * than the property. So the value is hoisted to ONE module constant, named, and commented
 * — one place to change, instead of 24 places to miss.
 *
 * `--space-8` is 30px. The marketing sections use `.site-section`'s 88px band; a working
 * page wants markedly less, because the patient came here to do something rather than to
 * read an argument.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: lay its children out. The screens inside it are built
 * from `.page-head` and `.cellgrid`, both of which carry their own vertical margins from
 * the token layer (24px and 52px), and those margins COLLAPSE against each other in a
 * block container. Wrapping them in a flex `<Stack>` would stop the collapse and add a gap
 * on top, silently loosening every one of these pages. A screen that wants a stack puts
 * one inside.
 *
 * @see packages/ui/src/tokens/site.css — `.site-wrap`, and the 52px `.cellgrid` margin
 */

/*
 * Hoisted to module scope rather than written at the call site, so React reuses one frozen
 * object across every render of every page instead of allocating a fresh one each time —
 * and so there is exactly one place in the app that spells this value.
 */
const PAGE_PADDING = { paddingBlock: 'var(--space-8)' } as const

export type PageBodyProps = {
  children: ReactNode
  /** Extra classes for the wrapper. Rare — the measure is the whole of its job. */
  className?: string | undefined
}

export function PageBody({ children, className }: PageBodyProps): ReactElement {
  return (
    <div className={className === undefined ? 'site-wrap' : `site-wrap ${className}`} style={PAGE_PADDING}>
      {children}
    </div>
  )
}
