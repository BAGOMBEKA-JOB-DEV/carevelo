import type { ReactElement, TextareaHTMLAttributes } from 'react'
import { cx } from './classNames'

/**
 * A multi-line input wearing `.textarea`.
 *
 * Resizable vertically and never horizontally — that is in the token layer, and it is
 * deliberate: a textarea a patient can drag wider than its column breaks the layout of the
 * form around it on a phone.
 *
 * WHAT THIS IS NOT: the consultation note editor. That surface has to persist a draft to
 * local storage as it is typed and reconcile it with the server on reconnect, because a
 * clinical record must never be lost to a dropped connection — see
 * docs/30-architecture/frontend-nextjs.md. That is a stateful client component belonging
 * to the consultations domain, built on this one, and putting any of it here would drag a
 * storage dependency into a package four apps import.
 */
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...rest }: TextareaProps): ReactElement {
  return <textarea className={cx('textarea', className)} {...rest} />
}
