import type { ReactElement } from 'react'
import { Stack } from '@carevelo/ui'
import { parsePolicyText } from './policyDocument'

/**
 * The clinic's consent policy, on screen, in one language, in full.
 *
 * NOT ONE WORD IS THIS COMPONENT'S. Everything rendered here arrives from
 * `GET /v1/consent-policies/current`, and every `ConsentRecord` pins a SHA-256 of it beside
 * the patient's decision — so the text on this screen IS the evidence, and rewriting,
 * trimming or summarising any of it would leave a record describing wording nobody read. The
 * markup is ours; the words are the clinic's.
 *
 * IT IS NOT BEHIND A LINK, AND THAT IS THE REQUIREMENT RATHER THAN A LAYOUT PREFERENCE. The
 * full policy is on the same screen as the decision, because a link nobody opens is not
 * information anybody received. That rules out a modal, a separate route and a PDF, and it is
 * why this renders inline however long the text runs.
 *
 * `lang` IS SET AND IT IS NOT DECORATION. This element carries an entire document in one
 * language inside a console whose chrome is English. Without the attribute a screen reader
 * pronounces Luganda with English phonology — and on the one screen a patient must genuinely
 * understand before agreeing, that is not a cosmetic defect. It is the difference between
 * informed consent and a recording of one.
 *
 * NO `dangerouslySetInnerHTML`, ANYWHERE, EVER. The clinic's trading name is interpolated
 * into this text by the backend, which means a tenant-controlled string is inside it. As React
 * children it is escaped by construction; as HTML it would be a stored-XSS hole on the one
 * screen in the product where a patient is being asked to trust what they are reading.
 *
 * THE MARKUP IS THE CONSOLE'S, NOT THE PORTAL'S. The patient portal renders the same document
 * inside `.site-doc`, which is built on the marketing radius scale; `spacing.css` is explicit
 * that the two scales do not cross. Here it is a plain flow with the console's own spacing
 * tokens, so a policy shown to a patient across a counter sits in the same visual register as
 * everything else on the screen the receptionist is working from.
 */
export function ConsentPolicyText({
  text,
  lang,
  titleId,
}: {
  text: string
  /** BCP 47 language tag — `en`, `lg`. Whatever key the API returned the prose under. */
  lang: string
  /**
   * Put on the document's own title so the section around it can be named by it.
   *
   * A `<section>` with no accessible name is a landmark a screen reader skips over, and this
   * is the section nobody should skip. The name is the policy's own title rather than a label
   * invented here — see the note above about whose words these are.
   */
  titleId?: string | undefined
}): ReactElement {
  const document = parsePolicyText(text)

  return (
    <div
      lang={lang}
      className="stack"
      style={{ gap: 'var(--space-5)', fontSize: 14.5, lineHeight: 1.6 }}
    >
      {document.title ? (
        <h3 id={titleId} className="title-sm">
          {document.title}
        </h3>
      ) : null}

      {document.sections.map((section, sectionIndex) => (
        /*
         * Indexed keys, and this is one of the few places that is right rather than lazy: the
         * list is derived from an immutable document in a single pass, never reordered, never
         * filtered and never appended to. There is no stable identifier in the source text to
         * use instead, and inventing one from the heading would collide the moment a policy
         * repeated a word.
         */
        <Stack as="section" key={sectionIndex} gap="3">
          {section.heading ? (
            <h4 className="field__label policy-heading">
              {section.heading}
            </h4>
          ) : null}

          {section.blocks.map((block, blockIndex) =>
            block.kind === 'paragraph' ? (
              <p key={blockIndex}>{block.text}</p>
            ) : (
              <ul key={blockIndex} className="policy-list">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </Stack>
      ))}
    </div>
  )
}
