import en from '../../messages/en.json'
import patientsEn from '../../messages/domains/Patients.en.json'
import schedulingEn from '../../messages/domains/Scheduling.en.json'
import paymentsEn from '../../messages/domains/Payments.en.json'
import consultationsEn from '../../messages/domains/Consultations.en.json'
import prescriptionsEn from '../../messages/domains/Prescriptions.en.json'
import deliveryEn from '../../messages/domains/Delivery.en.json'
import routesEn from '../../messages/domains/Routes.en.json'
import errorsEn from '../../messages/domains/Errors.en.json'
import type { Locale } from './locales'

/**
 * The catalogue, assembled once.
 *
 * This file used to hold two of these and a bidirectional `satisfies` between them, which
 * made a key present in one language and missing from the other a COMPILE error. That gate
 * went with the Luganda catalogue — there is no second file left to disagree with — and it
 * is worth saying plainly what replaced it rather than letting a reader assume the check
 * was merely dropped. next-intl still resolves a missing message to the literal string
 * `Namespace.key`, so a key referenced from a screen and absent from the JSON would still
 * print `Privacy.retentionRecords` into the middle of a patient's privacy notice, silently.
 * Two things now stand where the `satisfies` pair stood: `app-config.d.ts` types every
 * `t()` call against the object below, so a key that does not exist is a compile error at
 * the CALL SITE; and i18n.test.ts walks the source for every key the app references and
 * fails if one of them does not resolve here. The first catches typos, the second catches a
 * key deleted from the catalogue while a screen still asks for it.
 *
 * The catalogue is imported statically rather than loaded per request. It is JSON in the
 * server bundle, no I/O happens, and the alternative — a dynamic import keyed by locale —
 * buys nothing and costs an await on every render.
 *
 * ONE FILE PER DOMAIN, merged here.
 *
 * The base catalogue holds the app-wide chrome; each domain owns its own namespace under
 * messages/domains/. That split is not tidiness — it is what lets several people (or
 * agents) add screens at once without every one of them editing the same thousand-line
 * JSON file and colliding on every save. The merge is a spread of STATIC imports, so
 * `typeof MESSAGES.en` stays precise and `AppConfig['Messages']` can be derived from it; a
 * dynamic glob would have bought convenience and thrown that away.
 *
 * `Errors` IS REGISTERED HERE EVEN THOUGH THE SCREEN THAT USES IT DOES NOT READ IT FROM
 * HERE, and that is worth stating plainly rather than leaving somebody to notice.
 * `app/error.tsx` is a React error boundary, so it is a client component by construction,
 * and this app deliberately mounts no `NextIntlClientProvider` — SiteShell sets out the
 * 150KB argument. It therefore imports the one JSON file directly. Registering the
 * namespace here is not what makes that screen work. What it buys is that
 * `AppConfig['Messages']` is typed from this object, so `getTranslations('Errors')` is a
 * checked call for any SERVER surface that needs this copy later — a `global-error.tsx`, or
 * a route that wants to say the same sentence without a boundary. Left unregistered, that
 * call would type-check as a missing namespace and render the literal text
 * `Errors.generic.body` to a patient.
 *
 * `Routes` IS THE ONE NAMESPACE THAT BELONGS TO NO DOMAIN, and it is deliberately thin. It
 * holds only what the route layer itself says: the words on the account hub, and the two
 * places where a route has to tell a patient that something cannot be done here yet. Every
 * sentence about booking, consent, payment, a prescription or a delivery lives in the
 * domain that owns that screen — a route that started writing clinical or financial copy
 * would be business logic in the routing tree, spelled in JSON instead of in TSX.
 */
const EN = {
  ...en,
  ...patientsEn,
  ...schedulingEn,
  ...paymentsEn,
  ...consultationsEn,
  ...prescriptionsEn,
  ...deliveryEn,
  ...routesEn,
  ...errorsEn,
}

/**
 * Keyed by locale rather than exported as the bare object, so `MESSAGES[locale]` in
 * request.ts stays the shape it is, and `Record<Locale, ...>` turns a language added to
 * LOCALES without a catalogue to go with it into a compile error rather than an `undefined`
 * handed to next-intl.
 */
export const MESSAGES = { en: EN } satisfies Record<Locale, typeof EN>
