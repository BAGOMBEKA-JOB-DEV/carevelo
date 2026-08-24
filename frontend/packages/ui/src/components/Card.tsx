import type { ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * A surface with a hairline round it.
 *
 * Sharp corners and a one-pixel border rather than a shadow, which is the house register:
 * this is a product that issues prescriptions and it should read as precise rather than
 * soft. The `brand` tone swaps the ground for `--brand-surface`, the clinic's pale tint —
 * used for the ONE card on a screen that is the clinic speaking, and no more, because a
 * page of tinted cards is a page with no emphasis left.
 *
 * `as` EXISTS BECAUSE THE ELEMENT IS NOT A STYLING DECISION. A card that groups a titled
 * region of a page is a `<section>` and should announce itself as one to a screen reader
 * navigating by landmark; a card in a list of prescriptions is an `<li>`. Giving those the
 * same `<div>` because they share a border is how a page ends up as a flat wall of
 * unlabelled boxes. Pair `as="section"` with `aria-labelledby` pointing at the heading
 * inside it — a region with no accessible name is skipped over.
 *
 * DELIBERATELY NOT HERE: a `title` prop, a header slot, an actions slot, a footer. Every
 * one of those is a guess about a layout no screen has asked for yet, and each would have
 * to be un-guessed later by whoever needs the fourth arrangement. The children are the
 * card.
 *
 * @example
 * <Card as="section" aria-labelledby="next-visit">
 *   <h2 id="next-visit" className="title">Your next visit</h2>
 *   …
 * </Card>
 */

export type CardElement = 'div' | 'section' | 'article' | 'li'

export type CardProps = {
  as?: CardElement | undefined
  /** `brand` is the clinic's tint. One per screen at most. */
  tone?: 'default' | 'brand' | undefined
  /** `tight` for a card in a dense grid, where the default 24px reads as slack. */
  padding?: 'default' | 'tight' | undefined
  id?: string | undefined
  className?: string | undefined
  'aria-labelledby'?: string | undefined
  'aria-label'?: string | undefined
  children: ReactNode
}

export function Card({
  as: Tag = 'div',
  tone = 'default',
  padding = 'default',
  id,
  className,
  'aria-labelledby': labelledBy,
  'aria-label': label,
  children,
}: CardProps): ReactElement {
  return (
    <Tag
      id={id}
      className={cx('card', padding === 'tight' && 'card-tight', tone === 'brand' && 'card-brand', className)}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Tag>
  )
}
