/**
 * The public surface of @carevelo/ui.
 *
 * Four apps import this package and none of them may import each other, so anything more
 * than one app needs lives here or gets written four times. What is here is deliberately
 * only what the patient journey has actually asked for — a booking form, a price, an
 * appointment time, a status, a disclosure. There is no Modal, no Tooltip, no Accordion
 * and no DataTable, because nothing has needed one yet and a component built on a guess is
 * a component someone has to work around later.
 *
 * EVERYTHING BELOW RENDERS ON THE SERVER. ThemeToggle is the single 'use client' in the
 * package, and it earns it: its entire job is to write to browser storage. Nothing in
 * components/ has a directive, which is what lets each one be a Server Component when a
 * server page imports it and a Client Component when a client page does — the choice
 * belongs to the surface, not to the primitive. The patient portal's booking path has a
 * 150KB first-load budget; a `'use client'` added here for convenience would spend it on
 * behalf of four apps at once.
 *
 * @see src/tokens/components.css — the classes these render. Read it before adding one.
 * @see frontend/README.md — why packages/ui and apps/<app>/src/components/ are separate
 */

export { applyBrand } from './brand/applyBrand'
export { brandStyle, tokensToStyle } from './brand/brandStyle'
export { isFullyBranded, resolveBrandTokens } from './brand/resolveBrandTokens'
export { BRAND_PROPERTIES, type BrandProperty, type BrandTokens, type TenantBranding } from './brand/types'
export { Icon, type IconName, type IconProps } from './icons/Icon'
export { ThemeToggle } from './theme'

/* ---- Actions ---- */
export {
  Button,
  buttonClass,
  type ButtonClassOptions,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button'

/* ---- Forms ----
   Field is the one to reach for first: it owns the label/hint/error wiring that a screen
   reader depends on and that nothing else in the toolchain can check. */
export { Field, type FieldControl, type FieldProps } from './components/Field'
export { Input, type InputProps } from './components/Input'
export { Select, type SelectProps } from './components/Select'
export { Textarea, type TextareaProps } from './components/Textarea'
export { Choice, type ChoiceOption, type ChoiceProps } from './components/Choice'

/* ---- Telling the patient something ---- */
export { Notice, type NoticeProps, type NoticeTone } from './components/Notice'
export { Badge, type BadgeProps, type BadgeTone } from './components/Badge'
export { Card, type CardElement, type CardProps } from './components/Card'
export { EmptyState, type EmptyStateProps } from './components/EmptyState'
export { Spinner, type SpinnerProps } from './components/Spinner'

/* ---- Values that must not be formatted by hand ----
   Both export a plain function beside the component, for the places markup cannot go: a
   document title, an aria-label, the body of a confirmation sentence. */
export { Money, formatMoney, type MoneyProps, type MoneyValue } from './components/Money'
export {
  DateTime,
  formatInstant,
  type DateTimeFormat,
  type DateTimeProps,
} from './components/DateTime'
