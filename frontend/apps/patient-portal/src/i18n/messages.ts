import en from '../../messages/en.json'
import lg from '../../messages/lg.json'
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
export const MESSAGES = { en, lg } satisfies Record<Locale, typeof en> &
  Record<Locale, typeof lg>
