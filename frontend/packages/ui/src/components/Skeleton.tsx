import type { ReactElement } from 'react'
import { Stack } from './Stack'
import { cx } from './classNames'

/**
 * The shape of what is coming, held on screen until it arrives.
 *
 * THE COUNT THIS RETIRES: zero loading.tsx, zero Suspense boundaries, zero skeletons and
 * one Spinner in the whole product — and a `.skeleton` class that has sat in the token
 * layer since the beginning with nothing using it. This is the component that lets a route
 * have a `loading.tsx` at all, which is the actual gap: without one, a slow list on a 3G
 * connection in Kampala is a blank white screen, and a blank screen is indistinguishable
 * from a broken one. People reload it, which makes it slower.
 *
 * WHY A SKELETON AND NOT A SPINNER
 *
 * A spinner says "wait" and takes no space, so the page jumps when the content lands and
 * whatever the reader was looking at moves out from under their thumb. A skeleton occupies
 * the room the content will occupy, so the arrival is a fill rather than a reflow. That is
 * the whole of its value, and it is also its whole obligation: a skeleton that is not the
 * shape of the thing it stands in for is worse than nothing, because it promises a layout
 * and then breaks it. Match the real content — three lines for a paragraph of three lines.
 *
 * Spinner.tsx makes the other half of this argument: use it for an indeterminate wait
 * whose shape is genuinely unknown, and give it words.
 *
 * IT DOES NOT PULSE FOR SOMEONE WHO ASKED FOR LESS MOTION
 *
 * `.skeleton` animates, and the reset caps every animation in the product at one 0.01ms
 * iteration under `prefers-reduced-motion: reduce`, so this renders as a still grey block
 * for a reader with a vestibular disorder. That is the intended outcome and not an
 * accident of the cascade — nothing here is understood through the movement, and a page
 * full of things breathing at 1.4s is exactly the pattern that setting exists to stop.
 * Same mechanism as Spinner; see the note beside `.skeleton` in components.css.
 *
 * `label` IS OPTIONAL, AND HERE IS THE HONEST VERSION OF WHY
 *
 * With a label this is a `role="status"` carrying that sentence; without one the whole
 * thing is `aria-hidden` and a screen reader passes over it, which is right when a page
 * announces its own loading somewhere better. Be aware of what the labelled form does and
 * does not buy you: a live region that is ALREADY in the document when it parses is not a
 * change, so nothing is spoken on a fresh load — Notice.tsx documents the same trap. It is
 * worth something when a region swaps in place, and it is worth nothing on first paint.
 * Do not use it to satisfy a checklist; use it where a region genuinely updates.
 *
 * @example
 * // app/(console)/queue/loading.tsx
 * <Stack gap="7">
 *   <Skeleton block="sm" />
 *   <Skeleton lines={4} />
 * </Stack>
 */

/** Block heights, as content shapes rather than spacing — see the note in space.ts. */
export type SkeletonBlock = 'sm' | 'md' | 'lg'

/** One to six. Beyond that a placeholder is a page shape, not a paragraph. */
export type SkeletonLines = 1 | 2 | 3 | 4 | 5 | 6

type SkeletonCommon = {
  /**
   * What is loading. Announced through `role="status"`, never shown. Omit it and the
   * placeholder is hidden from screen readers entirely — read the note above first.
   */
  label?: string | undefined
  className?: string | undefined
}

/*
 * Two arms, discriminated by whether `block` is DECLARED — the shape Button uses for
 * `href` and Grid for `panel`. `<Skeleton lines={3} block="md" />` does not compile,
 * because a run of text lines and a solid block are two different placeholders and a
 * component that quietly ignored one of them would be a component nobody could predict.
 */
type SkeletonAsText = SkeletonCommon & { lines?: SkeletonLines | undefined }

type SkeletonAsBlock = SkeletonCommon & { block: SkeletonBlock }

export type SkeletonProps = SkeletonAsText | SkeletonAsBlock

/*
 * Not on the space scale, deliberately. These are the heights of CONTENT — a stat band, a
 * card, a chart — and `--space-*` is the distance BETWEEN things. Borrowing the spacing
 * scale for a content height is how a scale ends up with a 220px step in it.
 */
const BLOCK_HEIGHT: Record<SkeletonBlock, string> = {
  sm: '64px',
  md: '120px',
  lg: '220px',
}

export function Skeleton(props: SkeletonProps): ReactElement {
  const { label, className } = props

  const body =
    'block' in props ? (
      <div className="skeleton" style={{ height: BLOCK_HEIGHT[props.block] }} />
    ) : (
      /* `0.72em` rather than a pixel height: the bar then tracks whatever type size it is
         standing in for, so the same component is the right thickness in a card heading
         and in body copy. The last line is short because that is what the last line of a
         paragraph looks like — a run of identical full-width bars reads as a table. */
      <Stack gap="3">
        {Array.from({ length: props.lines ?? 3 }, (_unused, index) => (
          <div
            /* Index as key is correct exactly here: this list is generated from a count,
               never reordered, and has no state to carry. */
            key={index}
            className="skeleton"
            style={{
              height: '0.72em',
              ...(index === (props.lines ?? 3) - 1 ? { width: '62%' } : {}),
            }}
          />
        ))}
      </Stack>
    )

  return (
    <div
      className={cx(className)}
      /* Labelled: a polite status region. Unlabelled: furniture, and a screen reader
         should walk straight past it rather than announce a grey rectangle. */
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'status' })}
    >
      {label === undefined ? null : <span className="sr-only">{label}</span>}
      {body}
    </div>
  )
}
