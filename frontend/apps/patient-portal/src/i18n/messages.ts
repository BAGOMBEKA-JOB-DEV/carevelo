import en from '../../messages/en.json'
import lg from '../../messages/lg.json'
import patientsEn from '../../messages/domains/Patients.en.json'
import patientsLg from '../../messages/domains/Patients.lg.json'
import schedulingEn from '../../messages/domains/Scheduling.en.json'
import schedulingLg from '../../messages/domains/Scheduling.lg.json'
import paymentsEn from '../../messages/domains/Payments.en.json'
import paymentsLg from '../../messages/domains/Payments.lg.json'
import consultationsEn from '../../messages/domains/Consultations.en.json'
import consultationsLg from '../../messages/domains/Consultations.lg.json'
import prescriptionsEn from '../../messages/domains/Prescriptions.en.json'
import prescriptionsLg from '../../messages/domains/Prescriptions.lg.json'
import deliveryEn from '../../messages/domains/Delivery.en.json'
import deliveryLg from '../../messages/domains/Delivery.lg.json'
import routesEn from '../../messages/domains/Routes.en.json'
import routesLg from '../../messages/domains/Routes.lg.json'
import errorsEn from '../../messages/domains/Errors.en.json'
import errorsLg from '../../messages/domains/Errors.lg.json'
import type { Locale } from './locales'

/**
 * The two catalogues, and the gate that keeps them the same shape.
 *
 * A KEY PRESENT IN ONE FILE AND MISSING FROM THE OTHER IS A CRASH, or worse — next-intl
 * resolves a missing message to the string `Namespace.key`, so a Luganda reader would see
 * `Privacy.retentionRecords` printed in the middle of a privacy notice and nothing would
 * fail. That is the failure mode this project keeps finding: silent, plausible, and
 * discovered by a user rather than by a build.
 *
 * `satisfies` in BOTH DIRECTIONS is what makes it a build error instead. Requiring `lg` to
 * be assignable to `typeof en` catches anything missing from the Luganda file; requiring
 * `en` to be assignable to `typeof lg` catches anything the Luganda file has that English
 * does not. Together the two are structural equality, checked by tsc on every run, on the
 * real files rather than on a fixture. i18n.test.ts asserts the same property at runtime
 * with a message a human can read, but this is the one that cannot be skipped.
 *
 * The catalogues are imported statically rather than loaded per request. They are JSON in
 * the server bundle, no I/O happens, and the alternative — a dynamic import keyed by
 * locale — buys nothing on a server that holds both anyway and costs an await on every
 * render.
 */
/*
 * ONE FILE PER DOMAIN, merged here.
 *
 * The base catalogues hold the app-wide chrome; each domain owns its own namespace pair
 * under messages/domains/. That split is not tidiness — it is what lets several people (or
 * agents) add screens at once without every one of them editing the same two thousand-line
 * JSON files and colliding on every save.
 *
 * The merge is a spread of STATIC imports, so `typeof EN` and `typeof LG` stay precise and
 * the bidirectional `satisfies` below still proves the two catalogues have the same shape.
 * A dynamic glob would have bought convenience and thrown that guarantee away.
 *
 * `Errors` IS REGISTERED HERE EVEN THOUGH THE SCREEN THAT USES IT DOES NOT READ IT FROM
 * HERE, and that is worth stating plainly rather than leaving somebody to notice.
 * `app/error.tsx` is a React error boundary, so it is a client component by construction,
 * and this app deliberately mounts no `NextIntlClientProvider` — SiteShell sets out the
 * 150KB argument. It therefore imports the two JSON files directly and pairs them with its
 * own bidirectional `satisfies`. Registering the namespace here is not what makes that
 * screen work.
 *
 * What it buys is the two things a namespace outside this object silently loses. The
 * catalogue pair joins the ONE structural check that covers every other domain, so a key
 * added to `Errors.en.json` and forgotten in the Luganda file is a compile error in this
 * file as well as in that one — two gates rather than one, and this is the gate a
 * translator's pull request runs into. And `AppConfig['Messages']` is typed from `MESSAGES.en`,
 * so `getTranslations('Errors')` becomes a checked call for any SERVER surface that needs
 * this copy later — a `global-error.tsx`, or a route that wants to say the same sentence
 * without a boundary. Left unregistered, that call would type-check as a missing namespace
 * and render the literal text `Errors.generic.body` to a patient, which is exactly the
 * failure mode the docblock above is about.
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

const LG = {
  ...lg,
  ...patientsLg,
  ...schedulingLg,
  ...paymentsLg,
  ...consultationsLg,
  ...prescriptionsLg,
  ...deliveryLg,
  ...routesLg,
  ...errorsLg,
}

export const MESSAGES = { en: EN, lg: LG } satisfies Record<Locale, typeof EN> &
  Record<Locale, typeof LG>
