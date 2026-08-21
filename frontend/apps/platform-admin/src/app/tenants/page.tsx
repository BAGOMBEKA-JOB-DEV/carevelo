import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `tenants` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Tenants' }

export default function TenantsPage() {
  return <PlannedSection id="tenants" />
}
