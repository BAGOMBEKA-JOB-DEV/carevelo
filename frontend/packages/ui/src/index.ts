/**
 * The public surface of @carevelo/ui.
 *
 * Four apps import this package and none of them may import each other, so anything more
 * than one app needs lives here or gets written four times. What is here is deliberately
 * only what the product has actually asked for — a booking form, a price, an appointment
 * time, a status, a disclosure, and now the layout that holds them apart. There is still
 * no Modal, no Tooltip and no Accordion, because nothing has needed one yet and a
 * component built on a guess is a component someone has to work around later.
 *
 * THE LAYOUT LAYER IS NEW AND IT WAS ADDED FROM A MEASUREMENT, NOT A PREFERENCE.
 *
 * There were 477 inline `style={{}}` across the four apps: 186 hand-set `marginTop`, 175
 * hand-set `gap`, 52 hand-set `fontSize`, a page header written out 45 times and a stat
 * block 54 times. And `var(--space-*)` appeared inline 404 times — which says the values
 * were right and the mechanism was missing. People reached for the token and had nowhere
 * to put it. Stack, Inline and Grid are somewhere to put it; PageHeader, Stat, Toolbar,
 * DataTable, Pagination and Skeleton are the six blocks that were being retyped. Each
 * file's docblock names the count it retires, because that count is the argument for the
 * file existing.
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

/* ---- Layout: where the space between things is decided ----
   Spacing props take a key from the scale in tokens/spacing.css and never a number, so a
   pixel value cannot get back in through a call site. Read space.ts for why the keys are
   the scale's own digits. */
export { Stack, type StackAlign, type StackElement, type StackProps } from './components/Stack'
export {
  Inline,
  type InlineAlign,
  type InlineElement,
  type InlineJustify,
  type InlineProps,
} from './components/Inline'
export { Grid, type GridColumns, type GridElement, type GridProps } from './components/Grid'
export type { Space } from './components/space'

/* ---- The blocks every screen was retyping ---- */
export { PageHeader, type PageHeaderProps } from './components/PageHeader'
export { Stat, type StatProps } from './components/Stat'
export { Toolbar, type ToolbarElement, type ToolbarProps } from './components/Toolbar'

/* ---- Lists of records ----
   DataTable wraps a real <table> rather than replacing one: the tables in this product are
   already real, and what they were missing was `scope` on 15 of 84 headers. Pagination is
   cursor-only by construction — docs/40-api/api-conventions.md, and a pharmacy queue paged
   by offset is an order nobody dispenses. */
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from './components/DataTable'
export { Pagination, type PaginationProps } from './components/Pagination'

/* ---- Waiting ----
   Skeleton is what makes a route's loading.tsx worth writing; Spinner above is for the
   indeterminate wait whose shape is genuinely unknown. */
export {
  Skeleton,
  type SkeletonBlock,
  type SkeletonLines,
  type SkeletonProps,
} from './components/Skeleton'

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
