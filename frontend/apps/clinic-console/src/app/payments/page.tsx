import type { Metadata } from 'next'
import { MoneyDeskScreen, SectionNav } from '@/domains/payments'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The landing screen for money, messages and the audit trail.
 *
 * THIN BY DESIGN: this route resolves search parameters and composes. Everything it renders
 * belongs to the payments domain, and `.dependency-cruiser.cjs` enforces that a domain can
 * never import back into `src/app` — business logic in the routing tree is logic nothing
 * looks for.
 *
 * `active="payments"` is the CONSOLE's section, from `src/components/sections.ts`.
 * `active="desk"` is the tab within it. Both are stated by the page rather than guessed by
 * the frame, because a layout is never told which route is rendering inside it — which is
 * how six nav links here were once permanently unhighlighted and, as it turned out,
 * permanently broken.
 */
export const metadata: Metadata = { title: 'Payments' }

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>
}) {
  const params = await searchParams

  return (
    <ConsoleShell title="Payments" active="payments">
      <SectionNav active="desk" />
      {/*
       * `problem` is handed over UNINTERPRETED. What each value means, and which of them are
       * safe to render, is the payments domain's business and is decided there against a
       * closed set — a route that started translating these into props with meanings of its
       * own would be the domain's rules restated in the routing tree, free to drift.
       */}
      <MoneyDeskScreen selfPath="/payments" problem={params.problem} />
    </ConsoleShell>
  )
}
