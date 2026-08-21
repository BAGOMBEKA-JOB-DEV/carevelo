import type { ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * A labelled form row: label, hint, control, error — wired together so a screen reader
 * hears all four as one thing.
 *
 * This is the most valuable component in the package, and it is worth saying exactly why.
 * The wiring is four attributes that must agree: the label's `htmlFor`, the control's
 * `id`, an `aria-describedby` naming the hint and the error, and an `aria-invalid` on the
 * control. Get any one wrong and the page still looks correct — the red text is right
 * there under the box — while a patient using a screen reader is told the field is fine
 * and moved on. Nothing catches that: not the compiler, not the linter, not a screenshot.
 * The only defence is that the wiring happens once, here, and is impossible to skip.
 *
 * WHY THE CHILD IS A FUNCTION
 *
 * The obvious API is `<Field label="…"><Input name="email" /></Field>` and it cannot be
 * built here. Passing the ids down needs either React context or `cloneElement`; context
 * does not exist in Server Components, and `cloneElement` guesses at the shape of a child
 * it has never seen and overwrites whatever the caller put there. A render prop is the one
 * option that is server-safe, explicit and type-checked — the caller can SEE what is being
 * put on their control, and the compiler stops them dropping it:
 *
 *   <Field name="email" label="Email address" error={errors.email}>
 *     {(control) => <Input {...control} type="email" autoComplete="email" required />}
 *   </Field>
 *
 * WHY THERE IS NO GENERATED ID
 *
 * `useId()` would work — React 19 exposes it to Server Components — and it is still the
 * wrong call here. Every control in this product needs a `name` regardless, because the
 * forms post natively for a patient whose JavaScript has not arrived; so a stable,
 * meaningful id is already in hand and the hook buys nothing but a `«r3»` in the markup
 * that no e2e selector, skip link or `#anchor` can point at. `id` defaults to `name` and
 * can be overridden where one page carries two forms with the same field in both.
 *
 * WHY THE HINT SITS ABOVE THE CONTROL
 *
 * Under it is the conventional place and the wrong one on a phone: the on-screen keyboard
 * covers the bottom half of the viewport the moment the input is focused, so a hint placed
 * below is hidden at precisely the moment it is needed. Above the control it is read
 * before typing starts. The error stays below, where the eye goes back to after a failed
 * submit, and `aria-describedby` makes the order irrelevant to a screen reader anyway.
 *
 * WHY THE ERROR IS NOT role="alert"
 *
 * Two reasons, and the first one surprises people. A live region that is ALREADY IN THE
 * DOCUMENT when it loads does not announce — assistive technology only speaks what appears
 * afterwards. Most errors on this surface arrive by a native form post, which is a fresh
 * document, so `role="alert"` on a field error would be inert exactly where it looks most
 * useful. Second, a form that fails validation usually fails several fields at once, and
 * six alerts firing together is noise that buries the first one. The announcement belongs
 * on ONE form-level `<Notice tone="bad">`, which is why that component takes `role="alert"`
 * by default; the per-field text is reached through `aria-describedby` when the patient
 * arrives at the control that is actually wrong.
 */

/**
 * The wiring, handed to the control. Spread it — `{...control}` — rather than picking
 * fields out of it, so a future addition reaches every call site at once.
 */
export type FieldControl = {
  id: string
  name: string
  /* Explicitly `| undefined` rather than optional: under exactOptionalPropertyTypes those
     are different types, and this object is spread onto DOM elements whose own attribute
     types are written the same way. */
  'aria-describedby': string | undefined
  'aria-invalid': true | undefined
}

export type FieldProps = {
  /** The form field name. Doubles as the control's id unless `id` says otherwise. */
  name: string
  label: string
  /** Only when one document holds two forms with a field of the same name. */
  id?: string | undefined
  /** What the patient needs to know BEFORE typing. Rendered above the control. */
  hint?: ReactNode | undefined
  /** The API's sentence, unchanged. Absent means the field is fine. */
  error?: string | undefined
  className?: string | undefined
  children: (control: FieldControl) => ReactNode
}

export function Field({
  name,
  label,
  id = name,
  hint,
  error,
  className,
  children,
}: FieldProps): ReactElement {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined

  const control: FieldControl = {
    id,
    name,
    /* Both, in reading order, when both are present. `cx` returns '' for neither, and an
       empty aria-describedby is a dangling reference rather than an absent one — so it
       becomes undefined and React omits the attribute entirely. */
    'aria-describedby': cx(hintId, errorId) || undefined,
    'aria-invalid': error ? true : undefined,
  }

  return (
    <div className={cx('field', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {children(control)}

      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
