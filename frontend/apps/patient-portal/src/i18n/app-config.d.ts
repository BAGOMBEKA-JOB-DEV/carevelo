/**
 * Teaching TypeScript what a message key is.
 *
 * WITHOUT THIS, `t('Privacy.retentionRecrods')` COMPILES. next-intl types its translator
 * against an `AppConfig` interface that is empty until an application fills it in, and an
 * empty one degrades every key to `string` — so a typo, a renamed key or a key deleted
 * from the catalogue is a runtime surprise printed into a patient's privacy notice. Filled
 * in, `t()` accepts only keys that exist and REQUIRES the ICU arguments the message
 * declares: forgetting `{clinic}` is a compile error rather than the literal text
 * `{clinic}` appearing on screen where a clinic's name should be.
 *
 * Declared against the MERGED English catalogue rather than messages/en.json alone, and
 * that distinction is the whole value of this file today. The base catalogue holds only
 * the app-wide chrome; every screen a domain owns lives in messages/domains/<Domain>.en.json
 * and is spread into MESSAGES by i18n/messages.ts. Pointed at en.json, `AppConfig` knew
 * nothing of those namespaces, so `getTranslations('Patients')` was a COMPILE ERROR while
 * `getTranslations('Header')` was fine — which left a domain author two choices, both bad:
 * cast the namespace away, or hard-code the strings into the JSX and lose Luganda
 * entirely. Pointed at MESSAGES.en it types the base and every domain at once, and a
 * domain catalogue added tomorrow is typed the moment messages.ts spreads it in.
 *
 * English specifically, because English is the language every screen is authored in.
 * messages.ts separately proves the Luganda side has the same shape through a
 * bidirectional `satisfies`, so one declaration is enough to type both.
 *
 * `import type {} from 'next-intl'` looks like a mistake and is load-bearing: TypeScript
 * refuses to augment a module it has not loaded into the program (TS2664), and an empty
 * type-only import is the smallest thing that loads it while erasing to nothing.
 *
 * A .d.ts rather than a .ts, because nothing imports this — it is ambient. That also keeps
 * it out of the boundary check's orphan rule, which exempts declaration files for exactly
 * this reason.
 */
import type {} from 'next-intl'

declare module 'next-intl' {
  interface AppConfig {
    Locale: 'en' | 'lg'
    Messages: (typeof import('./messages'))['MESSAGES']['en']
  }
}
