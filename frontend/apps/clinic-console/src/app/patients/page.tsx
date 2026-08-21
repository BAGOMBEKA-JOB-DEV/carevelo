import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `patients` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Patients' }

export default function PatientsPage() {
  return <PlannedSection id="patients" />
}
