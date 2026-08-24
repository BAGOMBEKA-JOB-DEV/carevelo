import type { ReactElement, ReactNode } from 'react'

/**
 * The content column of a signed-in patient page: the site's measure, and the air above
 * and below it.
 *
 * THE COUNT THIS RETIRES: 27 copies of `<div className="site-wrap" style={{ paddingBlock:
 * 'var(--space-8)' }}>` — by a distance the most-repeated inline style in this app, and
 * the clearest example of the thing the layout sweep was called for. The token was right
 * every one of those 27 times. There was simply nowhere to put it, so it went in a style
 * attribute, 27 times, where 27 chances existed to type `--space-7` by mistake.
 *
 * WHY IT LIVES HERE AND NOT IN packages/ui
 *
 * `.site-wrap` is the patient surface's measure — 1280px and a 24px gutter, tapering to
 * 18px below 480px — and the marketing chrome it belongs to is this app's alone. The
 * console, the rider view and the platform console have their own shells and would never
 * import this. frontend/README.md draws that line: packages/ui is what more than one app
 * needs, and apps/<app>/src/components/ is what one app needs. This is the second kind.
 *
 * WHY THE PADDING IS A CLASS NOW AND NOT A STYLE PROPERTY
 *
 * It used to be a hoisted module constant, and the docblock that shipped with it said
 * plainly that `.site-wrap--page` in tokens/site.css was the right long-term home and that
 * the sweep did not own that file. It does now, so the value moved: `.site-wrap--page` is
 * one declaration in the layer that already owns `.site-wrap`, `.site-section` and every
 * other piece of this surface's chrome, and it is read there beside the 88px marketing
 * band it deliberately differs from. That is the argument the constant could only gesture
 * at from inside the app.
 *
 * The distinction worth keeping hold of: Stack, Inline and Grid decide the space BETWEEN
 * things, and no primitive in that layer models the space AROUND them — correctly, because
 * a `padding` prop on Stack is the first step of a utility framework and the layer is
 * deliberately not one. Page chrome is not a layout decision a screen takes. It is a frame
 * every working page in this app wears, so it is a class, worn once, here.
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
 * @see packages/ui/src/tokens/site.css — `.site-wrap--page`, and the 52px `.cellgrid` margin
 */

export type PageBodyProps = {
  children: ReactNode
  /** Extra classes for the wrapper. Rare — the measure is the whole of its job. */
  className?: string | undefined
}

export function PageBody({ children, className }: PageBodyProps): ReactElement {
  return (
    <div className={className === undefined ? 'site-wrap site-wrap--page' : `site-wrap site-wrap--page ${className}`}>
      {children}
    </div>
  )
}
