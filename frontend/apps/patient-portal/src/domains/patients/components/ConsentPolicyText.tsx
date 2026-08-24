import type { ReactElement } from 'react'
import { parsePolicyText } from './policyDocument'

/**
 * The clinic's consent policy, on screen, in one language, in full.
 *
 * NOT ONE WORD IS THIS COMPONENT'S. Everything rendered here arrives from
 * `GET /v1/consent-policies/current`, and `ConsentRecord` pins a SHA-256 of it beside the
 * patient's decision — so the text on this screen is the evidence, and rewriting, trimming
 * or summarising any of it would leave a record describing wording nobody read. The markup
 * is ours; the words are the clinic's.
 *
 * IT IS ALSO NOT BEHIND A LINK, WHICH IS THE REQUIREMENT. "The full policy text is available
 * on the same screen — not behind a link that nobody opens." That rules out a modal, a
 * `/policy` route and a PDF, and it is why this renders inline however long the text is.
 *
 * `lang` IS SET AND IT IS NOT DECORATION. This element carries an entire document in one
 * language inside a page that may be in the other. Without the attribute a screen reader
 * pronounces Luganda with English phonology, which for the one screen a patient must
 * genuinely understand before agreeing is not a cosmetic defect — it is the difference
 * between informed consent and a recording of one. Browsers use it for hyphenation and
 * spell-checking too, but the reason it is here is the first one.
 *
 * NO `dangerouslySetInnerHTML`, ANYWHERE, EVER. The clinic's trading name is interpolated
 * into this text by the backend, which means a tenant-controlled string is inside it. As
 * React children it is escaped by construction; as HTML it would be a stored-XSS hole on
 * the one page in the product a patient is asked to trust.
 */
export function ConsentPolicyText({
  text,
  lang,
  titleId,
  /**
   * The heading level the document's own title takes. The consent screen puts the policy
   * under its `<h1>` and wants `<h2>`; the second-language disclosure is already inside a
   * `<summary>` and wants to start lower, so nothing outranks the section it is nested in.
   */
  titleAs: TitleTag = 'h2',
  headingAs: HeadingTag = 'h3',
}: {
  text: string
  lang: string
  /**
   * Put on the document's own title so the section around it can be named by it.
   *
   * A `<section>` with no accessible name is a landmark a screen reader skips over, and
   * this is the section a patient must not skip. The name is the policy's own title rather
   * than a label invented here — see the note above about whose words these are.
   */
  titleId?: string | undefined
  titleAs?: 'h2' | 'h3' | undefined
  headingAs?: 'h3' | 'h4' | undefined
}): ReactElement {
  const document = parsePolicyText(text)

  return (
    /* `.site-doc--inline`: the same prose treatment as /privacy and /terms, without the
       820px measure and the 88px tail those pages get from standing alone. This policy is
       rendered INSIDE a card that already owns both, and a second copy of each inset the
       policy from its own heading. It is a modifier rather than a second class so that the
       text a patient reads before consenting and the text they read afterwards cannot
       drift apart — see tokens/site.css. */
    <div className="site-doc site-doc--inline" lang={lang}>
      {document.title ? <TitleTag id={titleId}>{document.title}</TitleTag> : null}

      {document.sections.map((section, sectionIndex) => (
        /*
         * Indexed keys, and this is one of the few places that is right rather than lazy:
         * the list is derived from an immutable document in a single pass, never reordered,
         * never filtered and never appended to. There is no stable identifier in the source
         * text to use instead, and inventing one from the heading would collide the moment
         * a policy repeated a word.
         */
        <section key={sectionIndex}>
          {section.heading ? <HeadingTag>{section.heading}</HeadingTag> : null}

          {section.blocks.map((block, blockIndex) =>
            block.kind === 'paragraph' ? (
              <p key={blockIndex}>{block.text}</p>
            ) : (
              <ul key={blockIndex}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </div>
  )
}
