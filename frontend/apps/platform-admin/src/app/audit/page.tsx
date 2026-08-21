import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `audit` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Audit' }

export default function AuditPage() {
  return <PlannedSection id="audit" />
}
