import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `completed` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Completed' }

export default function CompletedPage() {
  return <PlannedSection id="completed" />
}
