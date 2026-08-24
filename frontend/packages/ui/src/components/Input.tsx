import type { InputHTMLAttributes, ReactElement } from 'react'
import { cx } from './classNames'

/**
 * A text input wearing `.input`.
 *
 * Thin to the point of looking pointless, and it is not: this is the single place the
 * class name is spelled. The alternative — `<input className="input" />` at every call
 * site across four apps — is how `classname="input"` and `.inpt` get shipped, and a
 * misspelt class in CSS is silent. It also gives `<Field>` something to spread its wiring
 * onto that reads as a peer of `<Select>` and `<Textarea>` rather than a raw element.
 *
 * Everything else is the platform's. No `value`/`onChange` pair is required and none is
 * added, because the forms on the patient surface post natively — an input that only works
 * once React has hydrated is an input that does not work on the connection this product is
 * built for.
 *
 * NOTE FOR NUMBERS: this is not the place to type an amount of money. Money is
 * `{amount_minor, currency}` and a free-text number input is how a float gets into that
 * path. See Money.tsx.
 *
 * @example
 * <Field name="phone" label="Phone number" hint="The number the clinic will call.">
 *   {(control) => <Input {...control} type="tel" inputMode="tel" autoComplete="tel" />}
 * </Field>
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...rest }: InputProps): ReactElement {
  return <input className={cx('input', className)} {...rest} />
}
