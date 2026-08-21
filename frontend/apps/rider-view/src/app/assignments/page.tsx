import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `assignments` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Assignments' }

export default function AssignmentsPage() {
  return <PlannedSection id="assignments" />
}
