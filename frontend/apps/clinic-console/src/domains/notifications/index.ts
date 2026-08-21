/**
 * The notifications domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * ------------------------------------------------------------------
 * WHAT A ROUTE HAS TO DO WITH THIS.
 *
 * One screen, three reads, fetched together:
 *
 *   const filters = readFilters(params)
 *   const [history, usage, catalogue] = await Promise.all([
 *     listNotifications(filters),
 *     getSmsUsage(),
 *     getTemplates(),
 *   ])
 *
 *   <MessagesScreen
 *     history={history} usage={usage} catalogue={catalogue}
 *     filters={filters} selfPath="/payments/messages"
 *   />
 *
 * IN PARALLEL, AND EACH FAILING ON ITS OWN. All three return an `Attempt` rather than
 * throwing, and each panel renders its own failure — the send history is what somebody came
 * for, and losing it because the catalogue call failed would answer "was the patient told?"
 * with a blank page.
 *
 * A 403 FROM ANY OF THEM IS NOT AN ERROR. All three are clinic-administrator reads: the send
 * history names which patients the clinic contacted and when, which is health-adjacent
 * whatever the message said. The screens render that as a boundary working rather than as a
 * fault, and the route must not turn it into an error page.
 *
 * `readFilters` belongs in the ROUTE, not here: it is search-parameter plumbing, and this
 * domain's job starts once the values are named.
 *
 * ------------------------------------------------------------------
 * WHAT THIS DOMAIN WILL NEVER OFFER.
 *
 * A SEND. There is no send endpoint. Every message leaves through the backend's `Notifier`
 * from a closed template catalogue, because a free-text send API would be a free-text
 * disclosure API on a channel that transits the mobile operator and lands on a lock screen.
 *
 * A TEMPLATE EDITOR. `GET /v1/notification-templates` is the only verb on that path. Every
 * template is asserted against a prohibited-content list, and an editable template is an
 * unreviewed one. There is no form and no disabled control implying one is coming.
 *
 * AN UNMASKED RECIPIENT. The API masks it and this domain does not undo that. Full numbers
 * on a list endpoint would make the send history a way to enumerate the clinic's patients by
 * phone number — a disclosure that a given person is a patient here.
 */

/* ---- Data. For a route to fetch and hand to the screen. ---- */
export { getSmsUsage, getTemplates, listNotifications } from './api/notifications'
export type { TemplateCatalogue } from './api/notifications'
export type {
  NotificationChannel,
  NotificationFilters,
  NotificationStatus,
  TemplateKey,
} from './api/types'

/**
 * The catalogues a route needs to validate its own search parameters against.
 *
 * Exported because the alternative is a route inventing its own list of valid statuses,
 * which is the contract restated in the routing tree and free to drift from the one the
 * screen renders. A route reads a string off the URL and asks these whether it is one.
 */
export { CHANNEL_LABELS, STATUS_LABELS, TEMPLATE_LABELS } from './api/types'

/* ---- The screen. ---- */
export { MessagesScreen, type MessagesScreenProps } from './components/MessagesScreen'
