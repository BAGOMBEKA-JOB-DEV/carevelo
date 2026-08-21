import type { ReactElement, ReactNode, SelectHTMLAttributes } from 'react'
import { cx } from './classNames'

/**
 * A native `<select>` wearing `.select`.
 *
 * NATIVE, AND THAT IS THE WHOLE POINT. Every design system eventually replaces the select
 * with a div-and-listbox so the chevron can be styled, and every one of them re-implements
 * keyboard handling, type-ahead, screen-reader semantics and scroll-into-view, badly. On
 * Android — the device this product is built for — the native control opens as a
 * full-screen sheet with system-sized rows, which is better than anything a listbox in a
 * 150KB budget could be. So the chevron stays the platform's.
 *
 * Options are children rather than an `options` array, because a real select needs
 * `<optgroup>` (clinicians by department, services by category) and a disabled
 * placeholder, and an array prop grows a schema to express those.
 *
 * A PLACEHOLDER IS A DISABLED OPTION, NOT AN EMPTY ONE. `<option value="" disabled>` plus
 * `defaultValue=""` shows the prompt and refuses to submit it; an enabled empty option
 * posts a blank the backend then has to reject.
 *
 * @example
 * <Field name="service" label="What do you need?">
 *   {(control) => (
 *     <Select {...control} defaultValue="" required>
 *       <option value="" disabled>Choose a service</option>
 *       {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
 *     </Select>
 *   )}
 * </Field>
 */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode
}

export function Select({ className, children, ...rest }: SelectProps): ReactElement {
  return (
    <select className={cx('select', className)} {...rest}>
      {children}
    </select>
  )
}
