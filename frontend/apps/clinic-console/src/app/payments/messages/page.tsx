import type { Metadata } from 'next'
import {
  CHANNEL_LABELS,
  MessagesScreen,
  STATUS_LABELS,
  TEMPLATE_LABELS,
  getSmsUsage,
  getTemplates,
  listNotifications,
  type NotificationChannel,
  type NotificationFilters,
  type NotificationStatus,
  type TemplateKey,
} from '@/domains/notifications'
import { SectionNav } from '@/domains/payments'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * What the clinic told its patients.
 *
 * COMPOSES TWO DOMAINS, WHICH IS WHAT A ROUTE IS FOR. The screen and its three reads come
 * from the notifications domain; the tab bar comes from payments, because these four screens
 * share one section of the console. Neither domain imports the other — that would be a build
 * failure, correctly — and the composition happens here.
 *
 * THE THREE READS GO IN PARALLEL AND EACH FAILS ON ITS OWN. `Promise.all` over three
 * functions that return an `Attempt` rather than throwing: the send history is what somebody
 * came here for, and losing it because the template catalogue call failed would answer "was
 * the patient told?" with a blank page. All three are clinic-administrator reads, so a 403 is
 * the ordinary outcome for everyone else and the screen renders it as a boundary rather than
 * a fault.
 *
 * SEARCH PARAMETERS ARE VALIDATED AGAINST THE DOMAIN'S OWN CATALOGUES, not against a list
 * written here. An unrecognised value becomes an absent filter rather than a 422: somebody
 * following a stale link should see the whole log, not an error about a status that no longer
 * exists. The catalogues are exported by the domain precisely so this route cannot invent a
 * second, drifting copy of them.
 */
export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    channel?: string
    template_key?: string
    cursor?: string
  }>
}) {
  const params = await searchParams

  /*
   * Built by assignment rather than as one object literal, because `exactOptionalPropertyTypes`
   * distinguishes "absent" from "explicitly undefined" — and `ApiClient` drops an absent
   * query parameter while an explicit `undefined` is still a key somebody has to remember to
   * handle.
   */
  const filters: NotificationFilters = {}

  if (params.status !== undefined && params.status in STATUS_LABELS) {
    filters.status = params.status as NotificationStatus
  }

  if (params.channel !== undefined && params.channel in CHANNEL_LABELS) {
    filters.channel = params.channel as NotificationChannel
  }

  if (params.template_key !== undefined && params.template_key in TEMPLATE_LABELS) {
    filters.templateKey = params.template_key as TemplateKey
  }

  if (params.cursor !== undefined && params.cursor !== '') {
    filters.cursor = params.cursor
  }

  const [history, usage, catalogue] = await Promise.all([
    listNotifications(filters),
    getSmsUsage(),
    getTemplates(),
  ])

  return (
    <ConsoleShell title="Payments" active="payments">
      <SectionNav active="messages" />
      <MessagesScreen
        history={history}
        usage={usage}
        catalogue={catalogue}
        filters={filters}
        selfPath="/payments/messages"
      />
    </ConsoleShell>
  )
}
