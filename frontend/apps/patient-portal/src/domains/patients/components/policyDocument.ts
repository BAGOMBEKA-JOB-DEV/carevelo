/**
 * The consent policy, turned from a block of API prose into blocks a page can mark up.
 *
 * WHY THIS EXISTS AT ALL, GIVEN THE RULE IS "RENDER IT, DO NOT PARAPHRASE IT".
 *
 * The policy the API returns is the legally operative text: `ConsentRecord` pins a SHA-256
 * of it, so months later a regulator, the clinic's auditor or the patient can re-render the
 * versioned wording and prove nothing was quietly changed. Not one word of it may be
 * rewritten here, and not one word is. What this file changes is the MARKUP, and only the
 * markup: it finds the headings the author already wrote and lets them be headings.
 *
 * That is not cosmetic. The screen is required to state seven things — what is collected,
 * that health data is special-category under the DPPA 2019, who controls and who processes,
 * the purpose, who it is shared with including the rider, retention, and the patient's
 * rights — and every one of them is a titled section of this text. Rendered as one
 * undifferentiated slab of forty lines, a person on a phone scrolls past all seven. Rendered
 * with real `<h3>`s, a screen-reader user can list them and jump, and a sighted reader can
 * see that "WHO SEES IT" is a section rather than a sentence. Same words, findable.
 *
 * THE HEURISTIC, AND WHY ITS FAILURE MODE IS SAFE. A heading is a line with letters in it
 * and no lowercase letter anywhere — which is what the policy's own author used, in both
 * languages ("WHO SEES IT", "BY'OKKIRIZA"). If the wording changes and the heuristic stops
 * matching, every line falls through to a paragraph and the document renders as continuous
 * prose: less navigable, still complete, still the exact text that was hashed. If it
 * over-matches, an emphatic all-caps sentence becomes a heading. Neither outcome adds,
 * removes or reorders a word, which is the only property that actually has to hold.
 *
 * Pure and free of React on purpose, so the parsing can be tested against the real
 * wording without rendering anything. See policyDocument.test.ts.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

export type PolicyBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }

export type PolicySection = {
  /** The author's own heading, verbatim, or null for text that arrived before one. */
  readonly heading: string | null
  readonly blocks: readonly PolicyBlock[]
}

export type PolicyDocument = {
  /** The document's opening line — "How {clinic} uses your health information". */
  readonly title: string | null
  readonly sections: readonly PolicySection[]
}

/**
 * A line the author meant as a heading.
 *
 * Letters, and none of them lowercase. `\p{Ll}` rather than a locale-naive `toUpperCase()`
 * comparison: a line of digits and punctuation ("2019") is equal to its own upper case and
 * is emphatically not a heading, and the property escape says what is actually meant.
 */
function isHeading(line: string): boolean {
  return /\p{L}/u.test(line) && !/\p{Ll}/u.test(line)
}

export function parsePolicyText(text: string): PolicyDocument {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  let title: string | null = null
  const sections: PolicySection[] = []

  let heading: string | null = null
  let blocks: PolicyBlock[] = []
  let paragraph: string[] = []
  let items: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  const flushList = (): void => {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items })
      items = []
    }
  }

  const flushSection = (): void => {
    flushParagraph()
    flushList()

    // A heading with nothing under it is still a section; an empty run of blank lines
    // before the first heading is not.
    if (heading !== null || blocks.length > 0) {
      sections.push({ heading, blocks })
    }

    blocks = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph()
      flushList()
      continue
    }

    if (isHeading(trimmed)) {
      flushSection()
      heading = trimmed
      continue
    }

    // The opening line, before any heading. Kept apart from the body so the page can set
    // it as the document's own title rather than as a first paragraph.
    if (title === null && heading === null && blocks.length === 0 && paragraph.length === 0) {
      title = trimmed
      continue
    }

    if (trimmed.startsWith('- ')) {
      flushParagraph()
      items.push(trimmed.slice(2).trim())
      continue
    }

    /*
     * A continuation of the bullet above it. The policy wraps its list items with two
     * spaces of indent, and joining them back is what keeps "We ask this only if and when
     * you choose delivery." attached to the bullet it belongs to rather than becoming a
     * stray paragraph after the list.
     */
    if (items.length > 0 && /^\s/.test(line)) {
      const last = items[items.length - 1]

      if (last !== undefined) {
        items[items.length - 1] = `${last} ${trimmed}`
        continue
      }
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushSection()

  return { title, sections }
}
