import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `dispatch` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Dispatch' }

export default function DispatchPage() {
  return <PlannedSection id="dispatch" />
}
