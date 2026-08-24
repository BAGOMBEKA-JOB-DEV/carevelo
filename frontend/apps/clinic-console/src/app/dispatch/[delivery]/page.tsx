import type { Metadata } from 'next'
import { Notice } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'
import { currentStaff, DeliveryScreen } from '@/domains/delivery'
import { DISPATCH_PATHS } from '../paths'

/**
 * One delivery's full record.
 *
 * The route carries the identifier and interprets nothing. Whether the delivery exists,
 * whether this member of staff may see it, and what a failure means are the domain's
 * business — a cross-tenant identifier is a 404 and the screen renders it as one, because a
 * 403 would confirm the record exists somewhere.
 *
 * NO REFERENCE IN THE TAB TITLE. `generateMetadata` would mean a second read of a record
 * that names a recipient, a telephone number and somebody's home address, for the sake of a
 * browser tab. A static title costs nothing.
 */
export const metadata: Metadata = { title: 'Delivery' }

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ delivery: string }>
}) {
  const [viewer, { delivery }] = await Promise.all([currentStaff(), params])

  return (
    <ConsoleShell title="Dispatch" active="dispatch">
      {viewer === null ? (
        <Notice tone="warn" title="You are not signed in">
          This delivery is behind the clinic&rsquo;s own authentication, and this session has
          ended. Sign in again to open it.
        </Notice>
      ) : viewer.password_change_required ? (
        <Notice tone="warn" title="Change your password first">
          Your account still has the password it was issued with. Until it is changed the API
          refuses everything else, so this record cannot load.
        </Notice>
      ) : (
        <DeliveryScreen deliveryId={delivery} viewer={viewer} paths={DISPATCH_PATHS} />
      )}
    </ConsoleShell>
  )
}
