import type { ReactElement, ReactNode } from 'react'
import { Icon, type IconName } from '../icons/Icon'
import { cx } from './classNames'

/**
 * A box of text that is not dismissible.
 *
 * The disclosures this product is required to show — the unverified-attestation note, the
 * delivery disclosure, "Carevelo provides the software and cannot answer a clinical
 * question" — plus the errors a form comes back with. Nothing here closes, because a
 * disclosure with an X on it is a disclosure that was not read.
 *
 * role="alert" WHEN IT CARRIES AN ERROR, AND ONE HONEST CAVEAT
 *
 * `tone="bad"` sets `role="alert"` by default, which is right for the client case: an
 * error rendered into a page that is already open is announced immediately, ahead of
 * whatever the reader was doing. What it does NOT do — and this catches people — is
 * announce on a fresh page load. A live region that is already in the document when it
 * parses is not a change, so nothing is spoken. Most of this product's errors arrive by a
 * native form post, which is a new document, so on those the attribute is inert and the
 * real accessibility comes from the notice sitting at the top of the form where focus
 * lands. Left on anyway, because it costs nothing and it is correct the moment a screen
 * updates in place.
 *
 * The tone is never the only signal. A red box says nothing to a colour-blind patient and
 * less to a screen reader, so give it a `title`, or write the sentence so it opens with
 * what went wrong.
 *
 * NEVER PUT CLINICAL CONTENT IN ONE OF THESE when it is standing in for an API error. The
 * API's problem details carry no clinical detail by design; a notice that adds some — "we
 * could not fill your prescription for X" — puts it in a screenshot, a support ticket and
 * a shoulder-surfer's line of sight.
 *
 * @example
 * <Notice tone="bad">{problem.detail}</Notice>
 * <Notice tone="info" icon="truck" title="Delivery is by a rider, not a courier">
 *   The rider carries a sealed package and cannot discuss what is in it.
 * </Notice>
 */

export type NoticeTone = 'neutral' | 'info' | 'warn' | 'bad'

export type NoticeProps = {
  /** `neutral` is the plain bordered box — the default, and what a disclosure wants. */
  tone?: NoticeTone | undefined
  /** A short lead line above the body. The word that carries the state without colour. */
  title?: string | undefined
  icon?: IconName | undefined
  /**
   * Announce this to a screen reader as soon as it appears. Defaults to true for
   * `tone="bad"`. Set it false for an error that is expected and repeated — a field-level
   * summary re-rendered on every keystroke would otherwise interrupt continuously.
   */
  announce?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

const TONE_CLASS: Record<NoticeTone, string | undefined> = {
  neutral: undefined,
  info: 'notice-info',
  warn: 'notice-warn',
  bad: 'notice-bad',
}

export function Notice({
  tone = 'neutral',
  title,
  icon,
  announce,
  className,
  children,
}: NoticeProps): ReactElement {
  const alert = announce ?? tone === 'bad'

  return (
    <div className={cx('notice', TONE_CLASS[tone], className)} role={alert ? 'alert' : undefined}>
      {/* `.ico` fixes the size so a long sentence beside it cannot squash the glyph. The
          icon is aria-hidden by construction — see Icon.tsx — so it adds no announcement. */}
      {icon ? <Icon name={icon} className="ico" /> : null}

      {title ? (
        <div className="stack grow">
          <strong>{title}</strong>
          <div>{children}</div>
        </div>
      ) : (
        <div className="grow">{children}</div>
      )}
    </div>
  )
}
