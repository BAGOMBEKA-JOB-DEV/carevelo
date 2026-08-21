import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import lg from '../../messages/lg.json'
import worklist from '../../messages/lg.needs-translation.json'
import { DEFAULT_LOCALE, LOCALES, negotiateLocale } from './locales'

/*
 * The catalogues, checked the way a translator will actually break them.
 *
 * messages.ts already makes a key missing from either file a COMPILE error, and that is
 * the stronger gate — it cannot be skipped and it fails before anything runs. What it
 * cannot express is everything below: that the worklist telling a translator what is left
 * to do is still true, that a translated sentence did not lose the placeholder holding the
 * clinic's name, and that language negotiation prefers the choice a patient made over a
 * setting somebody made on their phone years ago.
 *
 * THE PLACEHOLDER TEST IS THE ONE THAT WILL EARN ITS KEEP. `{clinic}` appears in about
 * half of these strings, and a translator working in a spreadsheet drops a brace far more
 * often than they drop a key. next-intl does not fail on a message whose placeholder was
 * deleted; it renders the sentence with the clinic's name simply absent, which on a
 * white-label product reads as a bug in somebody else's software.
 *
 * NOTE FOR WHOEVER RUNS `pnpm typecheck` AND SEES THIS FILE FAIL TO RESOLVE `vitest`.
 * apps/patient-portal does not declare vitest, so tsc and dependency-cruiser cannot find
 * the import even though the suite runs — vitest resolves its own package. That gap is
 * pre-existing, it already affects domains/identity/api/session.test.ts, and vitest.config.ts
 * documents both the cause and the one-line fix:
 *
 *     pnpm --filter @carevelo/patient-portal add -D vitest@4.1.10
 */

type Leaf = { path: string; value: string }

function leaves(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'string') {
    return [{ path: prefix, value: node }]
  }

  if (node === null || typeof node !== 'object') {
    return []
  }

  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  )
}

/** Every `{name}` an ICU message declares, which the translation has to keep. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1] ?? '').sort()
}

/** Every `<tag>` a rich message opens, which becomes a real element at render time. */
function tags(message: string): string[] {
  return [...message.matchAll(/<(\w+)>/g)].map((match) => match[1] ?? '').sort()
}

const english = leaves(en)
const luganda = leaves(lg)

describe('the message catalogues', () => {
  it('hold exactly the same keys in both languages', () => {
    // Sorted so the failure names the missing keys rather than reporting that two long
    // arrays differ somewhere.
    expect(luganda.map((leaf) => leaf.path).sort()).toEqual(
      english.map((leaf) => leaf.path).sort(),
    )
  })

  it('keep every placeholder and every rich tag through translation', () => {
    const lugandaByPath = new Map(luganda.map((leaf) => [leaf.path, leaf.value]))

    for (const { path, value } of english) {
      const translation = lugandaByPath.get(path) ?? ''

      expect({ path, placeholders: placeholders(translation), tags: tags(translation) })
        .toEqual({ path, placeholders: placeholders(value), tags: tags(value) })
    }
  })
})

describe('the Luganda worklist', () => {
  const lugandaByPath = new Map(luganda.map((leaf) => [leaf.path, leaf.value]))
  const englishByPath = new Map(english.map((leaf) => [leaf.path, leaf.value]))

  it('names only keys that exist', () => {
    const named = [...worklist.needsTranslation, ...worklist.identicalOnPurpose]

    expect(named.filter((path) => !englishByPath.has(path))).toEqual([])
  })

  it('never lists a key twice', () => {
    const named = [...worklist.needsTranslation, ...worklist.identicalOnPurpose]

    expect(named.length).toBe(new Set(named).size)
  })

  /*
   * The invariant that makes the worklist worth having. An untranslated string is one
   * whose Luganda value is still the English one, and every such string must be accounted
   * for: either a translator has yet to reach it, or it is a brand name, a numeral or a
   * drug name that is identical on purpose. Both directions are checked, so translating a
   * string turns this red until its line is removed from the worklist — which is how the
   * list stays honest instead of quietly describing last month's catalogue.
   */
  it('accounts for every string that still reads in English', () => {
    const accountedFor = new Set([
      ...worklist.needsTranslation,
      ...worklist.identicalOnPurpose,
    ])

    const stillEnglish = english
      .filter(({ path, value }) => lugandaByPath.get(path) === value)
      .map(({ path }) => path)

    expect(stillEnglish.filter((path) => !accountedFor.has(path))).toEqual([])
    expect([...accountedFor].filter((path) => !stillEnglish.includes(path))).toEqual([])
  })
})

describe('choosing a language for a request', () => {
  it('prefers the cookie, because it is the choice the patient actually made', () => {
    // Even against a browser that asks for the other language at full weight: the setting
    // in an Android menu is often years old and often not theirs.
    expect(negotiateLocale('lg', 'en-GB,en;q=0.9')).toBe('lg')
    expect(negotiateLocale('en', 'lg')).toBe('en')
  })

  it('ignores a cookie value that is not a language we hold', () => {
    expect(negotiateLocale('sw', 'lg')).toBe('lg')
    expect(negotiateLocale('', null)).toBe(DEFAULT_LOCALE)
  })

  it('reads Accept-Language by weight rather than by position', () => {
    expect(negotiateLocale(undefined, 'sw;q=0.9,lg;q=0.8,en;q=0.1')).toBe('lg')
    expect(negotiateLocale(undefined, 'lg;q=0.2,en;q=0.8')).toBe('en')
  })

  it('matches on the primary subtag, so lg-UG is Luganda', () => {
    expect(negotiateLocale(undefined, 'lg-UG')).toBe('lg')
    expect(negotiateLocale(undefined, 'en-US,en;q=0.9')).toBe('en')
  })

  it('treats an explicit q=0 as a refusal rather than a preference', () => {
    expect(negotiateLocale(undefined, 'lg;q=0,en;q=0.5')).toBe('en')
  })

  it('falls back to English when the browser names nothing we hold', () => {
    expect(negotiateLocale(undefined, 'sw-KE,fr;q=0.7')).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale(undefined, undefined)).toBe(DEFAULT_LOCALE)
  })

  it('takes * as permission to pick rather than as a preference', () => {
    expect(negotiateLocale(undefined, '*')).toBe(DEFAULT_LOCALE)
  })

  it('offers exactly the languages the product promises', () => {
    expect([...LOCALES]).toEqual(['en', 'lg'])
  })
})
