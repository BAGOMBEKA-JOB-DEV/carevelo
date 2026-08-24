import { describe, expect, it } from 'vitest'
import { parsePolicyText } from './policyDocument'

/*
 * The parser, checked against the property that actually matters.
 *
 * There is exactly one invariant worth guarding here and it is not "the headings are
 * right": it is that NO WORD IS ADDED, REMOVED OR REORDERED. `ConsentRecord` pins a hash of
 * the text the patient was shown, so a parser that silently dropped a line would produce a
 * screen whose evidence trail describes wording nobody read — which is the precise failure
 * DPPA 2019's "demonstrable" requirement exists to prevent, and one that no amount of
 * eyeballing a rendered page would catch.
 *
 * So the first test reassembles every word out of the parsed document and compares it to
 * the input. The rest are about navigability, which is a real but lesser concern.
 *
 * THE ONE THING THE COMPARISON DROPS FROM THE INPUT IS THE `- ` AT THE START OF A BULLET,
 * and only there. That hyphen is the author's MARKUP for a list rather than a word of the
 * policy: the renderer re-expresses it as a real `<li>`, whose marker the browser draws.
 * Keeping it would fail the invariant for text nobody lost. It is stripped by an anchored
 * `^- ` rather than by discarding every bare hyphen, because the real English policy uses a
 * standalone dash mid-sentence — "a package reference - never your diagnosis" — and a
 * parser that ate THAT one would be exactly the bug this test exists to catch.
 *
 * The fixture is the shape of the real policy — an opening line, ALL-CAPS section headings,
 * paragraphs, and a wrapped bullet list — including a Luganda heading with an apostrophe in
 * it, because that is the character most likely to break a naive uppercase test.
 */

const POLICY = `How Kira Medical Centre uses your health information

WHAT WE COLLECT
Your name, your phone number and any other contact details you give us, plus
the health information that arises from your care here.

WHO IS RESPONSIBLE
Kira Medical Centre is responsible for your information.

WHAT YOU ARE AGREEING TO
We ask separately, and you may agree to one and not the other:
- Data processing: using your information to provide care. Without this,
  nothing can proceed.
- Telemedicine: consulting a clinician remotely, by video or voice.

Nothing on this screen is ticked for you.
`

const words = (value: string): string[] => value.split(/\s+/).filter((word) => word !== '')

/** The author's words, without the `- ` that opens a bullet. See the note above. */
const wordsOfSource = (value: string): string[] => words(value.replace(/^- /gm, ''))

function everyWordOf(text: string): string[] {
  const document = parsePolicyText(text)

  return [
    ...words(document.title ?? ''),
    ...document.sections.flatMap((section) => [
      ...words(section.heading ?? ''),
      ...section.blocks.flatMap((block) =>
        block.kind === 'paragraph' ? words(block.text) : block.items.flatMap(words),
      ),
    ]),
  ]
}

describe('the consent policy parser', () => {
  it('keeps every word, in order — the property the text hash depends on', () => {
    expect(everyWordOf(POLICY)).toEqual(wordsOfSource(POLICY))
  })

  it('keeps every word of the Luganda wording too, apostrophes and all', () => {
    const luganda = `Engeri Kira gy'ekozesaamu amawulire go ag'obulamu

AMAWULIRE AG'OBULAMU GA NJAWULO
Okusinziira ku tteeka lya Uganda, amawulire ag'obulamu ga kika kya njawulo.

BY'OKKIRIZA
- Okukozesa amawulire: okukuwa obujjanjabi.
`

    expect(everyWordOf(luganda)).toEqual(wordsOfSource(luganda))
  })

  /*
   * The real English policy writes "a package reference - never your diagnosis". A dash
   * standing alone mid-sentence is a WORD of the text, not a bullet, and losing it would
   * change the sentence a patient is asked to agree to while the hash still claimed
   * otherwise. Guarded separately because the invariant tests above deliberately strip the
   * `- ` that opens a line, and this is the case that strip must not reach.
   */
  it('keeps a standalone dash inside a sentence, which is a word rather than a bullet', () => {
    const document = parsePolicyText('Title\n\nA package reference - never your diagnosis.\n')

    expect(document.sections[0]?.blocks[0]).toEqual({
      kind: 'paragraph',
      text: 'A package reference - never your diagnosis.',
    })
  })

  it('takes the opening line as the title rather than as a first paragraph', () => {
    expect(parsePolicyText(POLICY).title).toBe('How Kira Medical Centre uses your health information')
  })

  it("finds the author's own headings, in order", () => {
    expect(parsePolicyText(POLICY).sections.map((section) => section.heading)).toEqual([
      'WHAT WE COLLECT',
      'WHO IS RESPONSIBLE',
      'WHAT YOU ARE AGREEING TO',
    ])
  })

  it('joins a wrapped bullet back into one item', () => {
    const agreeing = parsePolicyText(POLICY).sections[2]
    const list = agreeing?.blocks.find((block) => block.kind === 'list')

    expect(list).toEqual({
      kind: 'list',
      items: [
        'Data processing: using your information to provide care. Without this, nothing can proceed.',
        'Telemedicine: consulting a clinician remotely, by video or voice.',
      ],
    })
  })

  it('keeps a paragraph that follows a list out of the list', () => {
    const agreeing = parsePolicyText(POLICY).sections[2]

    expect(agreeing?.blocks.at(-1)).toEqual({
      kind: 'paragraph',
      text: 'Nothing on this screen is ticked for you.',
    })
  })

  /*
   * The degradation that has to stay safe. Reworded prose with no ALL-CAPS heading in it
   * must still render in full — as continuous paragraphs, which is less navigable and
   * entirely complete. A parser that threw, or that returned nothing, would take the
   * consent screen down on a wording change.
   */
  it('renders prose with no headings as plain paragraphs rather than as nothing', () => {
    const prose = 'A title line.\n\nOne paragraph.\n\nAnother paragraph.\n'
    const document = parsePolicyText(prose)

    expect(document.title).toBe('A title line.')
    expect(document.sections).toEqual([
      {
        heading: null,
        blocks: [
          { kind: 'paragraph', text: 'One paragraph.' },
          { kind: 'paragraph', text: 'Another paragraph.' },
        ],
      },
    ])
  })

  it('treats a line of digits as text rather than as a heading', () => {
    const document = parsePolicyText('Title\n\n2019\n')

    expect(document.sections[0]?.heading).toBeNull()
  })

  it('does not fall over on an empty policy', () => {
    expect(parsePolicyText('')).toEqual({ title: null, sections: [] })
  })
})
