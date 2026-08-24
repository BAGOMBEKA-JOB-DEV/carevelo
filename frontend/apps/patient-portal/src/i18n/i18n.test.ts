import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALES } from './locales'
import { MESSAGES } from './messages'

/*
 * The one check on the message layer that still earns its place.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WENT. This file used to police a three-state convention
 * across two catalogues: every leaf key in messages/lg.json was either translated, or
 * listed in a worklist as awaiting a translator, or listed as identical-on-purpose, and the
 * suite failed if a key was in none of the three or in more than one. That convention
 * existed to keep an honest account of how much of the Luganda catalogue was real prose and
 * how much was English wearing a Luganda label. The answer settled at 7%, the translator
 * did not come, and the locale was removed — see i18n/locales.ts for the argument. A
 * convention that describes one file cannot outlive that file, so it went with it.
 *
 * WHAT REPLACES IT IS THE CHECK THE TWO-CATALOGUE VERSION NEVER MADE. Both of the old gates
 * — the `satisfies` pair in messages.ts and the key-set comparison here — asked whether the
 * two CATALOGUES agreed with each other. Neither ever asked whether the catalogue agreed
 * with the APP. That is the gap that actually reaches a patient: next-intl resolves a
 * message it cannot find to the literal string `Namespace.key`, so a key renamed in the
 * JSON while a screen still asks for the old one prints `Privacy.retentionRecords` into the
 * middle of a privacy notice, renders fine, throws nothing, and is discovered by a user.
 *
 * `app-config.d.ts` catches most of that at compile time, and it is the stronger gate where
 * it reaches — but it reaches only as far as the literal argument of a `t()` call. It says
 * nothing about the eight call sites that build a key from a value at runtime, and those
 * are precisely the keys a catalogue edit is most likely to strand: `t(`methods.${method}.label`)`
 * still compiles when one payment method loses its label, and fails on the screen of
 * whoever paid that way. So the test below reads the SOURCE, collects every key the app
 * asks for including the computed ones, and requires all of them to resolve.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK is the other direction — a key in the catalogue that
 * no screen reads. That is dead weight in a JSON file, not a defect on a patient's screen,
 * and a test that failed on it would fail every time somebody wrote the copy before the
 * component. Worth a periodic sweep; not worth a gate.
 *
 * THE SCANNER IS A REGEX OVER SOURCE TEXT RATHER THAN A TYPESCRIPT AST WALK, and that is a
 * deliberate trade rather than laziness. An AST walk needs the compiler as a test-time
 * dependency and a resolver good enough to follow a binding across a destructuring — for a
 * codebase that spells this one thing exactly two ways, both matched below. The risk of a
 * text scanner is that it silently matches NOTHING after some refactor and reports a green
 * board on an empty set, which is the same class of failure this project keeps finding. So
 * the first assertion is a floor on how many references it found: if a change to how this
 * app calls `getTranslations` drops the scanner's hit rate off a cliff, that is a failure
 * with the reason written on it rather than a suite that quietly stopped testing.
 */

/**
 * This app's `src/`, resolved from this file rather than from the working directory —
 * `pnpm test` runs the whole workspace from frontend/, so a relative path would be wrong.
 *
 * `join(..., '..', '..')` rather than the tidier `new URL('..', import.meta.url)`, and that
 * is not a style choice. This project runs under jsdom, whose `URL` global SHADOWS Node's;
 * `fileURLToPath` rejects the resulting object with "The URL must be of scheme file" even
 * though the href is a perfectly good `file://` one. Converting the string first sidesteps
 * a global that the test environment owns.
 */
const SOURCE_ROOT = join(fileURLToPath(import.meta.url), '..', '..')

/**
 * `const t = await getTranslations('Patients')` — the plain form, one namespace bound to
 * one name.
 */
const DIRECT_BINDING =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+getTranslations\(\s*'([A-Za-z]+)'\s*\)/g

/**
 * `const [t, common] = await Promise.all([getTranslations('Patients'), getTranslations('Common')])`
 * — the form most screens here use, because a page resolving its tenant, its session and
 * two namespaces should do it in one round of awaits rather than four. The names and the
 * calls are matched positionally; an element that is not a `getTranslations` call (a
 * `resolveTenant()`, a `currentUser()`) simply binds no namespace and its name is skipped.
 */
const DESTRUCTURED_BINDING =
  /(?:const|let)\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g

type Reference = { file: string; namespace: string; key: string }

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }

    // Test files are excluded: a fixture key invented by a test is not a key the app
    // renders, and requiring one to exist in the catalogue would be backwards.
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : []
  })
}

/** Split an argument list on top-level commas, so a nested `f(a, b)` stays one element. */
function topLevelElements(list: string): string[] {
  const elements: string[] = []
  let depth = 0
  let current = ''

  for (const character of list) {
    if (character === ',' && depth === 0) {
      elements.push(current)
      current = ''
      continue
    }

    if ('([{'.includes(character)) depth += 1
    if (')]}'.includes(character)) depth -= 1

    current += character
  }

  if (current.trim() !== '') {
    elements.push(current)
  }

  return elements
}

/** Which namespace each translator name in one file is bound to. */
function bindingsIn(source: string): Map<string, string> {
  const bindings = new Map<string, string>()

  for (const match of source.matchAll(DIRECT_BINDING)) {
    bindings.set(match[1] ?? '', match[2] ?? '')
  }

  for (const match of source.matchAll(DESTRUCTURED_BINDING)) {
    const names = (match[1] ?? '').split(',').map((name) => name.trim())

    topLevelElements(match[2] ?? '').forEach((element, index) => {
      const namespace = /^getTranslations\(\s*'([A-Za-z]+)'\s*\)$/.exec(element.trim())?.[1]
      const name = names[index]

      if (namespace !== undefined && name !== undefined && name !== '') {
        bindings.set(name, namespace)
      }
    })
  }

  return bindings
}

/** Every message key this app asks for, with the namespace it asks for it in. */
function references(): Reference[] {
  return sourceFiles(SOURCE_ROOT).flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    const bindings = bindingsIn(source)

    if (bindings.size === 0) {
      return []
    }

    /*
     * `t('key')`, `t.rich('key')` and the backtick form. Only the names actually bound in
     * THIS file are matched, so an unrelated `format(...)` or `humanise(...)` call cannot
     * be mistaken for a translation.
     */
    const call = new RegExp(
      `\\b(${[...bindings.keys()].join('|')})(?:\\.rich)?\\(\\s*(['\`])((?:\\\\.|(?!\\2).)*)\\2`,
      'g',
    )

    return [...source.matchAll(call)].map((match) => ({
      file: relative(SOURCE_ROOT, file),
      namespace: bindings.get(match[1] ?? '') ?? '',
      key: match[3] ?? '',
    }))
  })
}

/**
 * Resolve one dotted path against the catalogue, expanding `*` — an interpolated segment —
 * over every child at that level.
 *
 * The expansion is what makes a computed key worth checking at all. `methods.${method}.label`
 * does not name one message, it names a SHAPE: every payment method the catalogue holds must
 * carry a label. Checking only that `methods` exists would pass a catalogue where four of
 * the five methods had lost theirs.
 *
 * Returns the paths that failed to resolve, so a failure names the exact key rather than
 * reporting that a boolean was false.
 */
function unresolved(path: string): string[] {
  const walk = (node: unknown, segments: string[], trail: string): string[] => {
    if (segments.length === 0) {
      // A path that lands on an object rather than a string is a namespace, not a message.
      // next-intl renders it as the literal key, which is the failure this test is about.
      return typeof node === 'string' ? [] : [trail]
    }

    if (node === null || typeof node !== 'object') {
      return [trail]
    }

    const [head = '', ...rest] = segments
    const children = node as Record<string, unknown>

    if (head.includes('*')) {
      const names = Object.keys(children)

      // An interpolated segment over an empty object resolves vacuously, which would make
      // an emptied namespace pass. It is a failure.
      return names.length === 0
        ? [trail]
        : names.flatMap((name) => walk(children[name], rest, `${trail}.${name}`))
    }

    return head in children ? walk(children[head], rest, `${trail}.${head}`) : [trail]
  }

  return walk(
    MESSAGES.en,
    path.replace(/\$\{[^}]*\}/g, '*').split('.'),
    '',
  ).map((failure) => (failure === '' ? path : failure.slice(1)))
}

const found = references()

describe('the message keys this app asks for', () => {
  /*
   * The floor that stops a broken scanner reading as a clean suite. Roughly 750 references
   * exist today across every screen in the portal; the number here is deliberately well
   * under that, so ordinary churn never touches it and only a scanner that has stopped
   * finding call sites can trip it.
   */
  it('are actually being collected, rather than a regex quietly matching nothing', () => {
    expect(found.length).toBeGreaterThan(400)

    // Every namespace registered in messages.ts should be reachable from somewhere; a
    // namespace nothing reads is copy paid for and never shown.
    const namespaces = new Set(found.map((reference) => reference.namespace))

    expect([...Object.keys(MESSAGES.en)].filter((name) => !namespaces.has(name))).toEqual([
      // `Errors` is read by app/error.tsx, which is a client error boundary and imports
      // its JSON directly rather than through getTranslations — messages.ts explains why.
      'Errors',
    ])
  })

  it('every one resolves to a message in the catalogue', () => {
    const missing = found.flatMap((reference) =>
      unresolved(`${reference.namespace}.${reference.key}`).map(
        (path) => `${path} (${reference.file})`,
      ),
    )

    // Sorted and de-duplicated so a catalogue edit that stranded one key names that key,
    // rather than printing the same path once per screen that reads it.
    expect([...new Set(missing)].sort()).toEqual([])
  })
})

describe('the catalogue', () => {
  it('holds one for every language the portal claims to read', () => {
    // `satisfies Record<Locale, ...>` in messages.ts already makes this a compile error.
    // Asserted again at runtime because the two are edited in different files by different
    // people, and this is the failure that would ship a locale with no words behind it.
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort())
  })
})
