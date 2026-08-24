import type { Metadata } from 'next'
import { BrandingScreen, OnboardingChecklist } from '@/domains/tenant'
import { TENANT_PATHS } from '../paths'

/**
 * Branding.
 *
 * Pass-through. `saved`, `problem` and `advice` are how the domain's own Server Actions
 * report back — a redirect cannot return a value — and what each means belongs to the
 * screen that renders them, not to the routing tree. `advice` is repeated once per
 * contrast advisory, so it arrives as an array whenever there is more than one.
 */
export const metadata: Metadata = { title: 'Branding' }

export default async function BrandingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string | string[]
    problem?: string | string[]
    advice?: string | string[]
  }>
}) {
  const params = await searchParams

  return (
    <div className="grid">
      <OnboardingChecklist paths={TENANT_PATHS} compact />
      <BrandingScreen
        paths={TENANT_PATHS}
        saved={params.saved}
        problem={params.problem}
        advice={params.advice}
      />
    </div>
  )
}
