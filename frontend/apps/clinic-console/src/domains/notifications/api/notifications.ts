import type { operations } from '@carevelo/api-client'
import { attempt, readClient, type Attempt } from './http'
import {
  notificationPageFrom,
  smsUsageFrom,
  templateFrom,
  type NotificationFilters,
  type NotificationPage,
  type NotificationTemplate,
  type SmsUsage,
} from './types'

/**
 * The three reads this domain makes, and the one it will never make.
 *
 * THERE IS NO SEND CALL HERE BECAUSE THERE IS NO SEND ENDPOINT, and that is a design
 * decision rather than a gap. Every message leaves the platform through the backend's
 * `Notifier`, rendered from a closed template catalogue that is asserted against a
 * prohibited-content list. A free-text send API would be a free-text disclosure API: SMS
 * transits the mobile operator and lands on a lock screen anybody standing nearby can read,
 * and WhatsApp is hosted outside Uganda and so is a cross-border transfer as well.
 *
 * THERE IS NO TEMPLATE EDITOR EITHER. `GET /v1/notification-templates` is the only verb on
 * that path — there is no PUT — because every template is reviewed against that same list,
 * and an editable template is an unreviewed one. The catalogue screen is a reading surface
 * and says so.
 *
 * ALL THREE ARE CLINIC-ADMINISTRATOR ONLY. The send history names which patients the clinic
 * contacted and when, which is health-adjacent whatever the message said, so it is not a
 * general staff view. `NotificationController::authoriseAdministrator()` enforces it and
 * this domain renders the 403 as a boundary rather than as a fault.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 * @see docs/50-security-compliance/rbac-matrix.md — Administration
 */

type IndexResponse =
  operations['v1.notifications.index']['responses'][200]['content']['application/json']

/**
 * What the clinic actually sent.
 *
 * The question behind this endpoint arrives after a missed appointment, an uncollected order
 * or a complaint: "was the patient told?" Every filter below narrows that question rather
 * than browsing the log for its own sake.
 *
 * THE FILTERS ARE PASSED THROUGH UNINTERPRETED, and `ApiClient` drops the undefined ones
 * rather than sending the string "undefined". An empty filter is an absent parameter, which
 * is what the API's `sometimes` rules expect.
 */
export async function listNotifications(
  filters: NotificationFilters,
): Promise<Attempt<NotificationPage>> {
  const result = await attempt(
    (async () => {
      const client = await readClient()

      return client.get<IndexResponse>('/v1/notifications', {
        query: {
          status: filters.status,
          channel: filters.channel,
          template_key: filters.templateKey,
          cursor: filters.cursor,
        },
      })
    })(),
  )

  return result.ok ? { ok: true, value: notificationPageFrom(result.value) } : result
}

type UsageResponse = {
  data?: { period_start?: unknown; sms?: unknown; rate_limit?: unknown }
  meta?: { note?: unknown }
}

/**
 * How much SMS this clinic has used this month.
 *
 * NAMED `getSmsUsage` AND NOT AFTER THE ENDPOINT, DELIBERATELY. The path is
 * `/v1/sms-balance`, and the word in that path describes nothing this product does: no
 * credit is held on the clinic's behalf, there is no ledger to draw down, and the response
 * is counts of messages the platform recorded. The endpoint name is the contract's and
 * cannot be changed from here; the vocabulary this app uses about it can be, and is.
 *
 * @see backend/app/Http/Controllers/Api/V1/NotificationController.php — smsBalance()
 */
export async function getSmsUsage(): Promise<Attempt<SmsUsage>> {
  const result = await attempt(
    (async () => {
      const client = await readClient()

      return client.get<UsageResponse>('/v1/sms-balance')
    })(),
  )

  return result.ok ? { ok: true, value: smsUsageFrom(result.value) } : result
}

export type TemplateCatalogue = {
  readonly templates: readonly NotificationTemplate[]
  /** The API's own caveat about SMS not being a confidential channel. Rendered verbatim. */
  readonly note: string
  /** Entries that came back in an unrecognised shape. Counted, never silently dropped. */
  readonly unreadable: number
}

type TemplatesResponse = {
  data?: unknown
  meta?: { note?: unknown }
}

/**
 * Every message this platform is capable of sending, in full, patterns included.
 *
 * RETURNED WHOLE BECAUSE THE CLINIC IS THE DATA CONTROLLER and is entitled to see exactly
 * what goes out under its own sender ID. It is also the review surface for the content rule
 * — the catalogue is short enough to read, which is the only reason that rule can be checked
 * by a person at all.
 */
export async function getTemplates(): Promise<Attempt<TemplateCatalogue>> {
  const result = await attempt(
    (async () => {
      const client = await readClient()

      return client.get<TemplatesResponse>('/v1/notification-templates')
    })(),
  )

  if (!result.ok) {
    return result
  }

  const raw = Array.isArray(result.value.data) ? result.value.data : []
  const templates: NotificationTemplate[] = []
  let unreadable = 0

  for (const candidate of raw) {
    const template = templateFrom(candidate)

    if (template === null) {
      unreadable += 1

      continue
    }

    templates.push(template)
  }

  return {
    ok: true,
    value: {
      templates,
      note: typeof result.value.meta?.note === 'string' ? result.value.meta.note : '',
      unreadable,
    },
  }
}
