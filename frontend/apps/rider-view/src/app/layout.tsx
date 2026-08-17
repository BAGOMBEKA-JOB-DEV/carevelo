import type { ReactNode } from 'react'
import '@carevelo/ui/tokens.css'
import { FieldShell } from '@/components/FieldShell'

/**
 * Carevelo-branded, behind authentication. No tenant resolution and no --brand-*
 * tokens: this surface belongs to Carevelo, not to the clinic. Only the patient
 * portal is clinic-branded.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export const metadata = {
  title: 'Deliveries',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FieldShell>{children}</FieldShell>
      </body>
    </html>
  )
}
