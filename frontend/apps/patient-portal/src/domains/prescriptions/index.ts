/**
 * The prescriptions domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here, and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * WHAT THIS DOMAIN DOES: shows a patient what has been prescribed for them, and gets them
 * the written document. It reads and it never writes, because a prescription is immutable
 * — `PrescriptionPolicy::update()` and `::delete()` both return false unconditionally and
 * there is no PUT or PATCH route to call. Nothing exported below can change a record, and
 * nothing added later should.
 *
 * ------------------------------------------------------------------------------------
 * HOW A ROUTE COMPOSES THIS
 *
 * The list, at `/prescriptions`:
 *
 *   const [tenant, t] = await Promise.all([resolveTenant(), getTranslations('Common')])
 *   const { cursor } = await searchParams          // Next 16: searchParams is a promise
 *   const result = await listPrescriptions({ cursor })
 *
 *   <PrescriptionList result={result} clinic={tenant.trading_name ?? t('thisClinic')} />
 *
 * `PrescriptionList` links each row to `${basePath}/{id}` and pages by CURSOR — it emits
 * `?cursor=…` and nothing else. There is no page number to plumb through, deliberately:
 * the backend pages this by cursor because an offset paginator skips rows when new
 * prescriptions arrive mid-read, and a skipped row here is a prescription nobody
 * dispenses.
 *
 * One prescription, at `/prescriptions/[id]`:
 *
 *   const { id } = await params
 *   const { document } = await searchParams
 *   const result = await getPrescription(id)
 *
 *   if (!result.ok && result.notFound) notFound()
 *
 *   <PrescriptionDetail
 *     result={result}
 *     clinic={clinic}
 *     selfHref={`/prescriptions/${id}`}
 *     documentState={document === 'rendering' || document === 'unavailable' ? document : undefined}
 *   />
 *
 * THREE THINGS THE ROUTE MUST DO AND THIS DOMAIN CANNOT:
 *
 *   1. REQUIRE A SESSION. Every screen here is clinical content, which this product shows
 *      in-app under authentication and nowhere else. Follow /account: `currentUser()`,
 *      redirect a guest to /sign-in, and redirect anyone whose `password_change_required`
 *      is set — while that flag stands, the API refuses every other request anyway.
 *   2. RESOLVE THE TENANT and pass `clinic`. The components take the clinic's NAME rather
 *      than the tenant object, so they stay free of `@/lib` and easy to render in a test.
 *   3. PASS `selfHref`. The document button posts to a Server Action, and a Server Action
 *      does not know the URL it was posted from; it needs somewhere to send the patient
 *      when the document is still being rendered.
 *
 * WHAT `notFound` MEANS AND WHAT IT MUST NOT BE TURNED INTO. A prescription belonging to
 * another clinic answers 404, exactly as one that never existed does. That is deliberate
 * — the API refuses to confirm a record exists elsewhere — so a route may render its 404
 * page, and must never render "that belongs to a different clinic".
 * ------------------------------------------------------------------------------------
 */
export { PrescriptionList } from './components/PrescriptionList'
export { PrescriptionDetail } from './components/PrescriptionDetail'

export { getPrescription, listPrescriptions } from './api/prescriptions'
export type {
  Prescription,
  PrescriptionItem,
  PrescriptionListResult,
  PrescriptionPage,
  PrescriptionResult,
  PrescriptionStatus,
} from './api/prescriptions'
