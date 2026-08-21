import type { ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * A group of radios or checkboxes, each one a full-width row you can hit with a thumb.
 *
 * Built for the two places this product asks a patient to pick from a short, fixed list
 * and cannot afford to be misread: the payment method, and consent. Both are moments where
 * the wrong answer costs money or crosses a legal line, so the row is the target rather
 * than the 18px circle inside it, and every option can carry a second line explaining what
 * choosing it will actually do ("You will get a prompt on your phone").
 *
 * WHY role="radiogroup" AND NOT <fieldset><legend>
 *
 * fieldset/legend is the canonical grouping markup and it is not used here, for a reason
 * that is about the error state rather than about layout. `aria-invalid` is not a global
 * attribute: it is only honoured on roles in the input family, and `group` — which is what
 * a `<fieldset>` maps to — is not one of them. `radiogroup` IS. So a fieldset can hold a
 * red border and an error message that a screen reader never connects to the group's
 * validity, while this can say it outright. (`<legend>` also refuses to participate in
 * flex and grid layout consistently across browsers, which is the reason people usually
 * give and the smaller of the two.)
 *
 * A checkbox group has no equivalent role — there is no `checkboxgroup` — so it stays a
 * plain `group` and the invalid state goes on the individual boxes, where `aria-invalid`
 * is honoured. The two branches below are that difference and nothing else.
 *
 * UNCONTROLLED, DELIBERATELY
 *
 * `defaultValue` and no `value`/`onChange` pair. The surface this serves posts its forms
 * natively so a patient on a stalled connection can still pay and still consent; a
 * controlled group would need a client boundary and a state hook, and would stop working
 * entirely with the bundle in flight. The browser already tracks which radio is selected,
 * correctly, for free. If a screen ever genuinely needs to react to the choice before
 * submit — revealing a phone-number field when mobile money is picked, say — that screen
 * is a client component and can hang a listener on the form; it does not need this
 * component to become one.
 *
 * ON `required`
 *
 * For radios it means what you expect: one of the group must be chosen. For CHECKBOXES the
 * native attribute is per-box, so `required` means EVERY box must be ticked. That is
 * exactly right for a consent group, where each element is separately mandatory, and
 * exactly wrong for "pick at least one of these" — for which there is no native
 * expression, and where the backend is authoritative anyway. Leave it off in that case
 * rather than inventing a client-side rule the API does not share.
 *
 * @example
 * <Choice
 *   name="method"
 *   legend="How would you like to pay?"
 *   required
 *   options={[
 *     { value: 'mtn_momo', label: 'MTN Mobile Money', note: 'You will get a prompt on your phone.' },
 *     { value: 'airtel_money', label: 'Airtel Money', note: 'You will get a prompt on your phone.' },
 *   ]}
 * />
 */

export type ChoiceOption = {
  /** Posted as the field's value. The API's enums are lowercase snake_case. */
  value: string
  label: string
  /** The consequence of choosing this, in one line. */
  note?: string | undefined
  disabled?: boolean | undefined
}

export type ChoiceProps = {
  name: string
  /** The question. Rendered as the group's accessible name. */
  legend: string
  options: readonly ChoiceOption[]
  /** Checkboxes instead of radios. */
  multiple?: boolean | undefined
  defaultValue?: string | readonly string[] | undefined
  hint?: ReactNode | undefined
  error?: string | undefined
  required?: boolean | undefined
  /** Only when one document holds two groups with the same name. */
  id?: string | undefined
  className?: string | undefined
}

export function Choice({
  name,
  legend,
  options,
  multiple = false,
  defaultValue,
  hint,
  error,
  required = false,
  id = name,
  className,
}: ChoiceProps): ReactElement {
  const legendId = `${id}-legend`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined

  const checked: readonly string[] =
    defaultValue === undefined ? [] : typeof defaultValue === 'string' ? [defaultValue] : defaultValue

  return (
    /* `.field` is the same column-with-a-gap the labelled row uses, so a Choice sits in a
       form at the same rhythm as an Input without a second layout class existing. */
    <div
      className={cx('field', className)}
      role={multiple ? 'group' : 'radiogroup'}
      aria-labelledby={legendId}
      aria-describedby={cx(hintId, errorId) || undefined}
      /* Only meaningful on radiogroup; see the note above. */
      aria-invalid={!multiple && error ? true : undefined}
      aria-required={!multiple && required ? true : undefined}
    >
      {/* A span, not a label: it names the GROUP, and a <label> that points at nothing is
          a label a screen reader may attach to the first control it finds. */}
      <span className="field__label" id={legendId}>
        {legend}
      </span>

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      <div className="choice__options">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`

          return (
            /* The whole row is the label, so the whole row is the hit target — which is
               what makes `--touch-min` on `.choice__option` mean something. */
            <label className="choice__option" key={option.value} htmlFor={optionId}>
              <input
                className="choice__input"
                id={optionId}
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                value={option.value}
                defaultChecked={checked.includes(option.value)}
                disabled={option.disabled ?? false}
                required={required}
                aria-invalid={multiple && error ? true : undefined}
              />
              <span className="choice__text">
                <span>{option.label}</span>
                {option.note ? <span className="choice__note">{option.note}</span> : null}
              </span>
            </label>
          )
        })}
      </div>

      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
