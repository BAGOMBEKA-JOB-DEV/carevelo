import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `pharmacy` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Pharmacy' }

export default function PharmacyPage() {
  return <PlannedSection id="pharmacy" />
}
