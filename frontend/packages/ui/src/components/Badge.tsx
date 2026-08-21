import type { ReactElement, ReactNode } from 'react'
import { Icon, type IconName } from '../icons/Icon'
import { cx } from './classNames'

/**
 * A small pill of status.
 *
 * THE WORD IS THE STATUS; THE COLOUR IS A SECOND OPINION. `children` is required and there
 * is no icon-only form, because a coloured dot is unreadable to a colour-blind pharmacist
 * and invisible to a screen reader — and the things these label include "controlled item"
 * and "substitution pending". The token layer makes the same argument next to `.badge`.
 *
 * The tones are ours, not the clinic's. A status badge is chrome that means the same thing
 * in every tenant, so it reads `--good` / `--warn` / `--bad` / `--info` rather than
 * `--brand-*`: a clinic whose brand is red must not end up with success in red.
 *
 * WHAT GOES IN ONE: a state from a documented state machine, in the product's own words.
 * Not a diagnosis, not a medicine name, not a note — a badge is the most screenshot-prone
 * element on any screen.
 *
 * @example
 * <Badge tone="good" icon="check">Paid</Badge>
 * <Badge tone="warn">Awaiting payment</Badge>
 */

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info'

export type BadgeProps = {
  tone?: BadgeTone | undefined
  icon?: IconName | undefined
  className?: string | undefined
  /** The word. Required — see above. */
  children: ReactNode
}

const TONE_CLASS: Record<BadgeTone, string | undefined> = {
  neutral: undefined,
  good: 'badge-good',
  warn: 'badge-warn',
  bad: 'badge-bad',
  info: 'badge-info',
}

export function Badge({ tone = 'neutral', icon, className, children }: BadgeProps): ReactElement {
  return (
    <span className={cx('badge', TONE_CLASS[tone], className)}>
      {/* 13px rather than the 18px default: `.badge` sets 12px text, and an icon at the
          reset's size would out-weigh the word it is decorating. */}
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  )
}
