import type { Metadata } from 'next'
import { SettingsHub } from '@/domains/tenant'
import { TENANT_PATHS } from './paths'

/**
 * Where a clinic administrator lands.
 *
 * The route holds no logic: it names the section and hands off. What remains before the
 * clinic is live, what this clinic is, and the way into everything else are all decisions
 * belonging to the tenant domain, and the shell around them belongs to `layout.tsx`.
 */
export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
  return <SettingsHub paths={TENANT_PATHS} />
}
