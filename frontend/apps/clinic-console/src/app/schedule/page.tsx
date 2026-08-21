import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `schedule` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Schedule' }

export default function SchedulePage() {
  return <PlannedSection id="schedule" />
}
