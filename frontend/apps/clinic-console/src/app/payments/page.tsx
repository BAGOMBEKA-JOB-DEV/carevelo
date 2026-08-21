import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `payments` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Payments' }

export default function PaymentsPage() {
  return <PlannedSection id="payments" />
}
