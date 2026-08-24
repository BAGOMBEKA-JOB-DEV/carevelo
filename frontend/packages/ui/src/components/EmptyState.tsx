import type { ReactElement, ReactNode } from 'react'
import { Icon, type IconName } from '../icons/Icon'
import { cx } from './classNames'

/**
 * What a list says when it has nothing in it.
 *
 * `children` IS REQUIRED, AND THAT IS THE POINT OF THE COMPONENT. "No results" on a
 * pharmacy queue is ambiguous between "nothing to dispense" and "your filter is wrong",
 * and only one of those needs somebody to do something. So the type will not let a screen
 * ship with the heading alone: `title` says what is not here, `children` says why and what
 * to do about it, and `action` is the button when there is one. The token layer makes the
 * same argument next to `.empty`; this is where it is enforced.
 *
 * IT IS NOT AN ERROR. An empty list means the query succeeded and returned nothing — use
 * `<Notice tone="bad">` for a request that failed, or a patient will read "you have no
 * prescriptions" as fact when the truth is that the API did not answer.
 *
 * AND IT IS NOT A PLACEHOLDER FOR SOMETHING UNBUILT. A plausible empty state for a feature
 * that does not exist is worse than saying so plainly: it leaves a patient waiting for a
 * card that will never populate.
 *
 * @example
 * <EmptyState icon="calendar" title="No appointments yet" action={<Button variant="brand" href="/book">Book a consultation</Button>}>
 *   When you book with the clinic, the appointment will appear here.
 * </EmptyState>
 */
export type EmptyStateProps = {
  /** What is not here. */
  title: string
  icon?: IconName | undefined
  /** The way out of it, when pressing something is the answer. */
  action?: ReactNode | undefined
  className?: string | undefined
  /** Why it is empty and what to do about it. Required — see above. */
  children: ReactNode
}

export function EmptyState({
  title,
  icon,
  action,
  className,
  children,
}: EmptyStateProps): ReactElement {
  return (
    <div className={cx('empty', className)}>
      {/* 28px: large enough to read as an illustration, small enough not to become one.
          `.empty` centres it, since an <svg> is inline and follows text-align. */}
      {icon ? <Icon name={icon} size={28} /> : null}

      <p className="empty__title">{title}</p>
      <p>{children}</p>

      {/* One spacing decision, and not worth a class of its own in the token layer — but
          still a token rather than a number, so it moves when the scale does. */}
      {action ? <div style={{ marginTop: 'var(--space-5)' }}>{action}</div> : null}
    </div>
  )
}
