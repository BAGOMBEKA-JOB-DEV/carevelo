import type { ReactElement } from 'react'
import { cx } from './classNames'

/**
 * A turning ring, for the short wait a patient cannot be told anything better about.
 *
 * USE IT SPARINGLY, AND ALWAYS WITH WORDS. On this surface most waiting is a mobile-money
 * collection resolving, and "Waiting for your MTN prompt" tells a patient something a
 * spinning circle never will. The `label` is not decoration: it is what a screen reader
 * announces, and it should say what is being waited FOR.
 *
 * `role="status"` rather than `role="alert"` — a wait is polite news, and interrupting
 * whatever the reader is on to say "loading" is exactly the behaviour that makes people
 * switch screen readers off.
 *
 * IT DOES NOT SPIN FOR EVERYONE, AND THAT IS CORRECT. The reset honours
 * `prefers-reduced-motion` globally, so a reader who has asked for less motion gets a
 * static ring and the label. Vestibular disorders are not rare and nothing here needs
 * animation to be understood.
 *
 * NOT A SKELETON. `.skeleton` in the token layer is for a block whose SHAPE is known ahead
 * of time — a table of rows, a card — and it is the better choice there, because it does
 * not make the page jump when the content lands.
 */
export type SpinnerProps = {
  /** What is being waited for. Announced; never shown. */
  label?: string | undefined
  /** Rendered size in px, square. 18 matches `.ico` in the reset. */
  size?: number | undefined
  className?: string | undefined
}

export function Spinner({ label = 'Loading', size = 18, className }: SpinnerProps): ReactElement {
  return (
    <span
      className={cx('spinner', className)}
      role="status"
      /* Inline rather than three size classes: the ring is one border-radius and one
         animation, and its only variable is how big it is. The border width stays 2px on
         purpose — scaling it turns a 12px spinner into a solid dot. */
      style={size === 18 ? undefined : { width: size, height: size }}
    >
      <span className="sr-only">{label}</span>
    </span>
  )
}
