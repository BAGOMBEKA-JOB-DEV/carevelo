import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * The button — and, when it is given an href, the link that looks like one.
 *
 * WHY ONE COMPONENT AND NOT TWO
 *
 * A large share of the things a patient presses in this product are navigations, not
 * actions: "Book a consultation", "See your prescription", "Back to the clinic". They are
 * anchors and must stay anchors — an anchor is what middle-clicks, what a screen reader
 * announces as a link, and what works when the bundle has not arrived. But they look
 * identical to the buttons beside them, and a design system that splits them into
 * `<Button>` and `<LinkButton>` invites the wrong one to be reached for at the moment
 * somebody is in a hurry. So the ELEMENT is chosen by the presence of `href`, in one
 * place, and the union type below makes the two sets of attributes mutually exclusive:
 * `<Button href="/x" disabled>` does not compile, because a disabled anchor is a lie.
 *
 * WHY IT IS NOT A CLIENT COMPONENT
 *
 * There is no 'use client' here and no hook, so this file renders to markup on the server
 * and ships nothing. That is what lets it be used from BOTH sides: imported by a Server
 * Component it stays server-rendered; imported by a Client Component it is bundled as
 * client code along with its `onClick`. Adding the directive would force every use — the
 * overwhelming majority of which are plain form submits and links — onto the client for
 * the benefit of the few that are not.
 *
 * `type` DEFAULTS TO "button", WHICH IS NOT WHAT HTML DOES
 *
 * A `<button>` with no type is a submit button. That default is a trap in a product built
 * on forms that post natively: the "Cancel" beside a submit, the disclosure toggle inside
 * a fieldset, and the icon button in a card header all live inside a `<form>` somewhere,
 * and all three would post it. Submitting is the consequential act, so it is the one that
 * has to be asked for: write `type="submit"` and mean it.
 *
 * THERE IS NO `sm` SIZE, ON PURPOSE
 *
 * `.btn-sm` exists in the token layer at 32px, which is eleven pixels under the
 * `--touch-min` floor the accessibility requirements set. A component layer that offers it
 * as `size="sm"` makes it the thing a tired person picks when a row looks crowded, and
 * every one of those is a control a patient on a cracked screen cannot reliably hit. If a
 * genuinely pointer-only surface ever needs it — a dense desktop table's row action — that
 * is a decision worth making explicitly, in that place, with its own comment.
 *
 * VARIANTS CARRY THE PATIENT/STAFF SPLIT
 *
 * `brand` paints with the CLINIC's colour and takes its foreground from
 * `--brand-primary-fg`, which the API computed for WCAG AA; `primary` paints with
 * Carevelo's own. They are not interchangeable, and which one is right is decided by whose
 * surface this is — patient-facing is always `brand`. See tokens/components.css.
 *
 * @example
 * <Button variant="brand" size="lg" block type="submit">Sign in</Button>
 * <Button variant="quiet" href="/prescriptions">Your prescriptions</Button>
 * <Button variant="ghost" aria-label="Close"><Icon name="x" /></Button>
 */

export type ButtonVariant = 'brand' | 'primary' | 'quiet' | 'ghost' | 'danger'

/** No `sm`. See the note above — `.btn-sm` is under the touch floor. */
export type ButtonSize = 'md' | 'lg'

type ButtonOwnProps = {
  /** Patient surfaces take `brand`; staff surfaces take `primary`. */
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  /** Full width. What a primary action wants on a phone. */
  block?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

/*
 * Two arms, discriminated by whether `href` is DECLARED rather than by a `kind` prop the
 * caller would have to remember. `'href' in props` narrows on that declaration, which is
 * why the button arm omits the key entirely instead of typing it `href?: undefined` — an
 * absent key cannot be spread onto a <button> that has no such attribute.
 */
type ButtonAsButton = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps>

type ButtonAsAnchor = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps> & { href: string }

export type ButtonProps = ButtonAsButton | ButtonAsAnchor

export type ButtonClassOptions = {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  block?: boolean | undefined
  className?: string | undefined
}

/**
 * The class list a button wears, on its own.
 *
 * Exported for the one case this component cannot serve: `next/link`. packages/ui is
 * framework-shared and does not import from Next — an app that needs client-side
 * navigation on a button-shaped control writes
 * `<Link className={buttonClass({ variant: 'brand' })} href="/x">`, and the class list is
 * still assembled here rather than typed out at the call site where a variant can be
 * misspelled into silence.
 */
export function buttonClass({
  variant = 'quiet',
  size = 'md',
  block = false,
  className,
}: ButtonClassOptions = {}): string {
  return cx(
    'btn',
    `btn-${variant}`,
    // `md` is the base `.btn`, so it has no modifier of its own.
    size === 'lg' && 'btn-lg',
    block && 'btn-block',
    className,
  )
}

export function Button(props: ButtonProps): ReactElement {
  if ('href' in props) {
    const { variant, size, block, className, children, ...anchor } = props

    return (
      <a className={buttonClass({ variant, size, block, className })} {...anchor}>
        {children}
      </a>
    )
  }

  const { variant, size, block, className, children, type = 'button', ...button } = props

  return (
    <button className={buttonClass({ variant, size, block, className })} type={type} {...button}>
      {children}
    </button>
  )
}
