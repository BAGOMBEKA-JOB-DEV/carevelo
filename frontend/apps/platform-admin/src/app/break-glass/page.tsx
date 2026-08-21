import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `break-glass` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Break-glass' }

export default function BreakGlassPage() {
  return <PlannedSection id="break-glass" />
}
