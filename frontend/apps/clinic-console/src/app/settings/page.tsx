import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/** Not built yet. What will live here is the `settings` entry in src/components/sections.ts. */
export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
  return <PlannedSection id="settings" />
}
