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
 * Declared against messages/en.json specifically, because English is the language every
 * screen is authored in. messages.ts separately proves the Luganda file has the same
 * shape, so one declaration is enough to type both.
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
    Messages: typeof import('../../messages/en.json')
  }
}
