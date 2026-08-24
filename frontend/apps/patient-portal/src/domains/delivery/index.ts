/**
 * The delivery domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here, and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * WHAT THIS DOMAIN DOES: three screens now, joined by one decision. The patient says
 * whether they are collecting their medicines or having them brought, then finds the
 * package in a list of their own deliveries, and then watches it move. The fulfilment
 * endpoint hangs off a dispense order rather than a delivery, and it is still filed here,
 * because everything that matters about that choice is a delivery concern: the
 * controlled-item exclusion, the service area, and the consent that decides whether a
 * patient's address may reach a rider.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THIS DOMAIN NEEDS FROM THE PATIENTS DOMAIN — PRECISELY
 *
 * `FulfilmentChoice` takes one prop, `deliveryConsent`, and the patients domain owns both
 * halves of it:
 *
 *   deliveryConsent: {
 *     granted: boolean   // does a `delivery_disclosure` consent stand for this patient
 *                        // RIGHT NOW? Withdrawal is a new record and the LATEST record
 *                        // decides, so an old grant does not survive a later withdrawal
 *                        // and this is not a fact that can be cached across requests.
 *                        // On the API side that question is
 *                        // GET /v1/patients/{patient}/consents, and
 *                        // App\Support\Consent\DeliveryDisclosure is how the backend
 *                        // asks it. The patients domain should expose a reader — say
 *                        // `hasDeliveryDisclosure(): Promise<boolean>` — from its own
 *                        // index.ts, and the route calls it.
 *
 *     href: string       // the page that CAPTURES that consent, used verbatim. Include
 *                        // whatever return parameter that page expects; this domain adds
 *                        // nothing to it and parses nothing out of it. After the patient
 *                        // agrees there, returning them to the fulfilment page is enough:
 *                        // `granted` is then true, the delivery option posts directly,
 *                        // and nobody is asked twice.
 *   }
 *
 * THIS DOMAIN DOES NOT AND MUST NOT WRITE THAT CONSENT. `POST /v1/patients/{patient}/consents`
 * pins the policy version AND a hash of the exact rendered text the patient read. The
 * patients domain owns that wording, as ConsentController owns it on the API side, and a
 * second writer would pin a hash to text it had reproduced by hand — "precisely the
 * failure the hash exists to catch". There is no consent call anywhere in this folder;
 * grep for one before adding a second.
 *
 * If the patients domain is not ready, a route can still render the screen: pass
 * `{ granted: false, href: '/…' }` pointing at whatever page will capture it. The delivery
 * option stays visible and says that consent will be asked for, which is honest, and the
 * API refuses a delivery without consent regardless — this path is the courteous route to
 * that rule, never the control.
 * ------------------------------------------------------------------------------------
 * HOW A ROUTE COMPOSES THIS
 *
 * Choosing, at `/orders/[id]/fulfilment`:
 *
 *   const { id } = await params
 *   const { fulfilmentError } = await searchParams
 *   const result = await getDispenseOrder(id)
 *
 *   if (!result.ok && result.notFound) notFound()
 *
 *   <FulfilmentChoice
 *     result={result}
 *     clinic={clinic}
 *     selfHref={`/orders/${id}/fulfilment`}
 *     deliveryConsent={{ granted, href: `/consent/delivery?return=/orders/${id}/fulfilment` }}
 *     error={typeof fulfilmentError === 'string' ? fulfilmentError : undefined}
 *   />
 *
 * Finding one, at `/deliveries`:
 *
 *   const { cursor } = await searchParams          // Next 16: searchParams is a promise
 *   const result = await listDeliveries({ cursor })
 *
 *   <DeliveryList result={result} clinic={clinic} />
 *
 * `DeliveryList` links each row to `${basePath}/{id}` and pages by CURSOR — it emits
 * `?cursor=…` and nothing else. There is no page number to plumb through, deliberately:
 * the dispatcher is assigning and riders are moving packages through the same table while
 * the patient reads it, which is precisely the traffic under which an offset paginator
 * duplicates and skips rows, and a skipped row here is a delivery nobody goes to the gate
 * for.
 *
 * Watching, at `/deliveries/[id]`:
 *
 *   const result = await getDeliveryTracking(id)
 *
 *   if (!result.ok && result.notFound) notFound()
 *
 *   <DeliveryTracking result={result} clinic={clinic} clinicPhone={tenant.contact?.phone} />
 *
 * The tracking screen refreshes itself while the delivery is still moving and offers a
 * manual check that is a plain form post, so it works with no JavaScript. Nothing needs
 * plumbing for either.
 *
 * THE ROUTE MUST REQUIRE A SESSION, exactly as the /account page does — `currentUser()`,
 * redirect a guest, redirect anyone whose `password_change_required` is set. Both screens
 * are behind a policy that admits the patient of the record and nobody else.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THE API LETS A PATIENT DO HERE, AND THE ONE THING IT STILL DOES NOT
 *
 *   1. THE LISTING GAP IS CLOSED, and this note is kept rather than deleted because every
 *      route in this domain was shaped by it and a reader should be able to see why.
 *      `DeliveryController::index()` and `DispenseOrderController::index()` both authorised
 *      `viewAny` — clinic staff only — while `viewOwn` sat unused on both policies. So a
 *      patient could open a delivery they held the identifier for and could not discover
 *      that identifier from any endpoint they were allowed to call: the id had to arrive
 *      from outside, in a message. Both controllers now branch on `AuthorisesPatientReads`,
 *      which authorises and narrows in one call, and the patient branch renders
 *      `PatientDeliveryResource` — the TRACKING shape, not the dispatcher's record. See
 *      `api/deliveries.ts` for exactly what a row may say and what it must never grow.
 *   2. THERE IS STILL NO PATIENT-CALLABLE RESCHEDULE. A failed delivery is sent out again
 *      by a dispatcher reassigning it on the clinic's own board. The tracking screen
 *      therefore offers the clinic's telephone number rather than a button that would do
 *      nothing.
 * ------------------------------------------------------------------------------------
 */
export { FulfilmentChoice } from './components/FulfilmentChoice'
export { DeliveryList } from './components/DeliveryList'
export { DeliveryTracking } from './components/DeliveryTracking'

export { getDispenseOrder } from './api/fulfilment'
export type { DispenseOrder, FulfilmentMethod, OrderResult } from './api/fulfilment'

export { listDeliveries } from './api/deliveries'
export type { DeliveryListResult, DeliveryPage, PatientDelivery } from './api/deliveries'

export { getDeliveryTracking } from './api/tracking'
export type { DeliveryMilestone, DeliveryStatus, TrackingResult } from './api/tracking'

/*
 * DELIBERATELY NOT EXPORTED: `toMilestones` and `lastMovedAt`.
 *
 * Both are readings of the milestone thread, and the thread is this domain's own. A route
 * that could parse milestones is a route that could decide what a status means, which is
 * the decision `components/status.ts` exists to keep in one place — the two screens here
 * must not be able to drift into describing the same package differently.
 */
