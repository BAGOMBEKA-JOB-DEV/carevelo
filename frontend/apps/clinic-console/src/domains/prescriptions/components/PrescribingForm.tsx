'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Field,
  Grid,
  Icon,
  Inline,
  Input,
  Notice,
  Stack,
  Textarea,
} from '@carevelo/ui'
import { issue } from '../api/actions'
import {
  documentLine,
  emptyItem,
  isStarted,
  MAX_ITEMS,
  problemsWith,
  type DraftItem,
} from '../model/items'
import type { Prescriber } from '../model/types'

/**
 * THE PRESCRIBING FORM AND ITS CONFIRMATION STEP.
 *
 * ====================================================================================
 * WHY THIS IS THE ONE CONTROL ON THIS CONSOLE THAT NEEDS JAVASCRIPT
 * ====================================================================================
 *
 * The requirement: "Prescribing requires an explicit confirmation step showing exactly what
 * will appear on the PDF — including the clinician's own name and registration number —
 * because it is a clinical act and should feel like one."
 *
 * "Exactly what will appear" means echoing back what the clinician typed. Every other
 * multi-step flow in this product does that with a round trip — post, redirect, render the
 * values from the URL — and here that is NOT AVAILABLE, because the values are medicine names
 * and directions. Putting those in a query string writes them into the browser's history, the
 * web server's access log and the `Referer` header of the next request. Clinical content must
 * never enter a log, and a URL is a log.
 *
 * The alternatives were considered and are worse:
 *
 *   - a cookie holding the draft: client storage of clinical data, which acceptance criterion
 *     7 permits for the note draft and for nothing else;
 *   - server-side draft storage: a new table and a new lifecycle for something that exists for
 *     forty seconds;
 *   - no confirmation step: the requirement, deleted.
 *
 * So the draft is held in this component's own state and never leaves the page until the
 * clinician confirms. That is the only option that keeps medicine names out of every log in
 * the chain, and it is why this file carries a directive that nothing else on the screen does.
 *
 * WITHOUT JAVASCRIPT THIS FORM DOES NOT SUBMIT, and the `<noscript>` below says so rather than
 * leaving a clinician pressing a dead button. Nothing else in the consultation depends on it:
 * the note still saves, the mode still records, the consultation still ends.
 *
 * ====================================================================================
 * WHAT THE CONFIRMATION SHOWS, AND WHY IT LOOKS LIKE A DOCUMENT
 * ====================================================================================
 *
 * It is deliberately not a "are you sure?" dialogue. It is the prescription, laid out as the
 * document will carry it, with the prescriber's own name and registration details at the
 * bottom where a signature goes — because the act being confirmed is signing, and a clinician
 * should recognise what they are putting their name to.
 *
 * ONCE ISSUED IT CANNOT BE EDITED. `PrescriptionPolicy::update()` returns false
 * unconditionally. The confirmation says so in as many words, because a clinician who thinks
 * they can fix a dose afterwards will confirm faster than one who knows they cannot.
 */

export type PrescribingFormProps = {
  consultationId: string
  prescriber: Prescriber
  patientName: string
}

export function PrescribingForm({ consultationId, prescriber, patientName }: PrescribingFormProps) {
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [problems, setProblems] = useState<readonly string[]>([])

  const update = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    )
  }

  const started = items.filter(isStarted)

  if (confirming) {
    return (
      <Confirmation
        items={started}
        prescriber={prescriber}
        patientName={patientName}
        sending={sending}
        failure={failure}
        onBack={() => {
          setConfirming(false)
          setFailure(null)
        }}
        onConfirm={async () => {
          setSending(true)
          setFailure(null)

          try {
            const result = await issue(consultationId, started)

            if (result.kind === 'issued') {
              /*
               * A FULL RELOAD RATHER THAN router.refresh(). The issued prescription has to
               * appear in the list below, the consultation's own digest changes, and — the
               * reason that decides it — this component's draft state must be thrown away.
               * A soft refresh would leave the medicines sitting in memory in a form the
               * clinician has already signed, one press away from being issued twice.
               */
              window.location.reload()

              return
            }

            setFailure(
              result.kind === 'blocked'
                ? result.message
                : (result.message ?? 'The clinic’s server did not accept it.'),
            )
          } catch {
            setFailure(
              'The prescription was not sent — there is no connection to the clinic’s server. '
              + 'Nothing has been issued. What you typed is still here.',
            )
          } finally {
            setSending(false)
          }
        }}
      />
    )
  }

  return (
    <Stack gap="5">
      <noscript>
        <Notice tone="warn" icon="help" title="Prescribing needs JavaScript on this screen">
          The confirmation step has to show you exactly what will be printed before you sign it,
          and it cannot do that without running in this browser — sending the medicines back and
          forth through the address bar would write them into the browser history and the
          server&rsquo;s logs, which is not allowed for clinical text. Everything else on this
          page works: the note is saving and the consultation can be ended.
        </Notice>
      </noscript>

      {problems.length > 0 ? (
        <Notice tone="warn" title="Not ready to issue">
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {items.map((item, index) => (
        <ItemRow
          key={index}
          index={index}
          item={item}
          onChange={(patch) => update(index, patch)}
          onRemove={items.length > 1 ? () => setItems((current) => current.filter((_, p) => p !== index)) : undefined}
        />
      ))}

      <Inline gap="3">
        {items.length < MAX_ITEMS ? (
          <Button variant="quiet" type="button" onClick={() => setItems((current) => [...current, emptyItem()])}>
            <Icon name="file" /> Add another medicine
          </Button>
        ) : null}

        <Button
          variant="primary"
          type="button"
          onClick={() => {
            const found = problemsWith(items)

            if (found.length > 0) {
              setProblems([...new Set(found.map((problem) => problem.message))])

              return
            }

            setProblems([])
            setConfirming(true)
          }}
        >
          <Icon name="arrowRight" /> Review before issuing
        </Button>
      </Inline>
    </Stack>
  )
}

function ItemRow({
  index,
  item,
  onChange,
  onRemove,
}: {
  index: number
  item: DraftItem
  onChange: (patch: Partial<DraftItem>) => void
  onRemove?: (() => void) | undefined
}) {
  const id = (field: string) => `item-${index}-${field}`

  return (
    /*
      SURVIVING INLINE STYLE, and the `<fieldset>` is the reason. Neither Card's element
      union nor Stack's includes one, and that is deliberate on both: a fieldset is a form
      grouping, not a layout box, and its non-legend children live in an anonymous content
      box the browser creates and the `<legend>` does not belong to. `.card stack` makes
      THAT box the flex column, so the gap belongs beside the class that establishes it.
      Moving the column onto an inner `<Stack>` would change which box the browser is
      laying the legend against, and a legend's position relative to a card's hairline is
      not something to alter on the way past a spacing sweep.
    */
    <fieldset className="card stack" style={{ gap: 'var(--space-4)' }}>
      <legend className="eyebrow">Medicine {index + 1}</legend>

      <Field name={id('name')} label="Medicine">
        {(control) => (
          <Input
            {...control}
            value={item.medicineName}
            onChange={(event) => onChange({ medicineName: event.target.value })}
            autoComplete="off"
          />
        )}
      </Field>

      {/* Three short fields on one line above 700px, stacked below it. A clinician on a phone
          gets full-width targets; one at a desk does not lose half the screen to them. */}
      <Grid cols={3} gap="4">
        <Field name={id('strength')} label="Strength" hint="e.g. 500 mg">
          {(control) => (
            <Input
              {...control}
              value={item.strength}
              onChange={(event) => onChange({ strength: event.target.value })}
              autoComplete="off"
            />
          )}
        </Field>

        <Field name={id('form')} label="Form" hint="e.g. tablet, syrup">
          {(control) => (
            <Input
              {...control}
              value={item.form}
              onChange={(event) => onChange({ form: event.target.value })}
              autoComplete="off"
            />
          )}
        </Field>

        <Field name={id('quantity')} label="Quantity">
          {(control) => (
            <Input
              {...control}
              value={item.quantity}
              onChange={(event) => onChange({ quantity: event.target.value })}
              inputMode="numeric"
              // A whole number of things to hand over. Not money — nothing in a prescription
              // carries an amount, and the pharmacy prices the dispense order separately.
              pattern="[0-9]*"
              autoComplete="off"
            />
          )}
        </Field>
      </Grid>

      <Field name={id('unit')} label="Unit" hint="e.g. tablets, ml. Leave blank if it does not apply.">
        {(control) => (
          <Input
            {...control}
            value={item.unit}
            onChange={(event) => onChange({ unit: event.target.value })}
            autoComplete="off"
          />
        )}
      </Field>

      <Field
        name={id('directions')}
        label="Directions"
        hint="How the patient takes it. A pharmacist who was not in the room reads this, and so does the patient."
      >
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={item.directions}
            onChange={(event) => onChange({ directions: event.target.value })}
          />
        )}
      </Field>

      {/*
        * CAREVELO DOES NOT CLASSIFY MEDICINES. The clinician flags a controlled item, because
        * classifying one would be a clinical judgement this platform has no standing to make.
        * The consequence is written beside the box rather than discovered at the pharmacy.
        */}
      {/*
        TWO SURVIVING INLINE STYLES, and both are on the hit target rather than on a column.

        The `<label>` keeps its own: Inline's element union stops at the elements that are
        layout and a `<label>` is not one — it is the CONTROL's extended hit area, and
        `--touch-min` is the 44px floor that hit area answers to. Wrapping an Inline inside
        it would put the row on a child and leave the floor on the parent, which is two
        places to get one target wrong. `.row`'s own gap is 12px and this pair wants 8, so
        the gap has to be stated beside it.

        The 600 on the first line is the shape `.choice__text` and `.choice__note` already
        describe, at 550 and 12.5px against this hand-rolled 600 and `.fine`'s 12px. Adopting
        them is the right end state and it is a VISIBLE change to a clinical control, which
        is not something a spacing sweep gets to make on the way past. Flagged in the report.
      */}
      <label className="row" style={{ gap: 'var(--space-3)', minHeight: 'var(--touch-min)' }}>
        <input
          type="checkbox"
          checked={item.isControlled}
          onChange={(event) => onChange({ isControlled: event.target.checked })}
        />
        <span className="stack">
          <span style={{ fontWeight: 600 }}>This is a controlled medicine</span>
          <span className="fine">
            Handled in person at the pharmacy and never routed to delivery. Carevelo does not
            classify medicines — this is your judgement.
          </span>
        </span>
      </label>

      {onRemove ? (
        <div>
          <Button variant="quiet" type="button" onClick={onRemove}>
            Remove this medicine
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}

/**
 * The document, before it exists.
 *
 * Laid out as the prescription will read, with the prescriber's details at the bottom where a
 * signature goes. See the header of this file for why this is a rendered document rather than
 * a confirmation dialogue.
 */
function Confirmation({
  items,
  prescriber,
  patientName,
  sending,
  failure,
  onBack,
  onConfirm,
}: {
  items: readonly DraftItem[]
  prescriber: Prescriber
  patientName: string
  sending: boolean
  failure: string | null
  onBack: () => void
  onConfirm: () => void
}) {
  return (
    <Stack gap="5">
      <Notice tone="warn" icon="shield" title="Check this. Once issued it cannot be changed.">
        A prescription is never edited — not by you, not by an administrator, not by Carevelo. A
        mistake is corrected by cancelling this one, with a reason, and issuing another. The
        document may already be on the patient&rsquo;s phone by then.
      </Notice>

      <Stack as="article" className="card" gap="5">
        <div className="stack">
          <span className="eyebrow">Prescription for</span>
          <span className="record-name">{patientName}</span>
        </div>

        {/* `<Stack as="ul">` and not `<ul className="stack">` with the marker turned off by
            hand: the hand-rolled version removed `list-style` and left the user agent's 40px
            `padding-left`, so this review list has been indented under the patient's name,
            and removing the marker without restoring `role="list"` costs the "list, 3 items"
            a screen reader announces before reading back what is about to be issued. */}
        <Stack as="ul" gap="4">
          {items.map((item, index) => (
            <Stack as="li" key={index} gap="2">
              {/*
                SURVIVING INLINE STYLE. 15.5px is a deliberate half-step above the 14.5px body
                size for the ONE line a clinician reads back before signing, and there is no
                class on the type scale between `.fine` at 12px and `.title` at 21px. It
                belongs in the token layer beside the sizes it sits between, and the token
                layer is not this task's to write — see the report.
              */}
              <span style={{ fontSize: 15.5 }}>{documentLine(item)}</span>
              {item.isControlled ? <Badge tone="warn">Controlled — in person only</Badge> : null}
            </Stack>
          ))}
        </Stack>

        {/*
          SURVIVING INLINE STYLE, and what is left of it is a rule and the space under it —
          the hairline that separates what is being prescribed from who is prescribing it.
          Neither is a step on the space scale and neither has a class in the token layer, so
          there is nothing for a primitive to take. The column INSIDE it is a Stack, which is
          the part that was a layout decision.
        */}
        <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-4)' }}>
          <Stack gap="2">
            <span className="eyebrow">Issued by</span>
            <PrescriberBlock prescriber={prescriber} />
          </Stack>
        </div>
      </Stack>

      {failure !== null ? (
        <Notice tone="bad" title="Nothing was issued">
          {failure}
        </Notice>
      ) : null}

      <Inline gap="3">
        <Button variant="primary" size="lg" type="button" onClick={onConfirm} disabled={sending}>
          <Icon name="check" /> {sending ? 'Issuing…' : 'Issue this prescription'}
        </Button>
        <Button variant="quiet" type="button" onClick={onBack} disabled={sending}>
          Go back and change it
        </Button>
      </Inline>
    </Stack>
  )
}

/**
 * The name and registration details that will appear on the document.
 *
 * THE `unreadable` BRANCH IS THE HONEST ONE AND IT IS THE COMMON CASE. A clinician cannot read
 * their own registration number back from this API — the endpoint that carries it is
 * administrator-only, because it is also the endpoint that grants the right to prescribe. The
 * long version of that is on `Prescriber` in model/types.ts.
 *
 * So rather than printing a blank where a registration number belongs, or omitting the line
 * and letting a clinician believe they have checked something they have not, this says exactly
 * what is true: the document will carry the number the clinic recorded, and this screen could
 * not read it back to show you.
 */
function PrescriberBlock({ prescriber }: { prescriber: Prescriber }) {
  if (prescriber.kind === 'known') {
    return (
      <Stack gap="1">
        {/* SURVIVING INLINE STYLE, and it is the same missing weight utility as the
            controlled-medicine label above: 600 is a step the type scale has no class for.
            Not `<strong>`, which is 700 and would also announce an emphasis nobody put on a
            clinician's own name. See the report. */}
        <span style={{ fontWeight: 600 }}>{prescriber.profile.name}</span>
        <span className="tnum">
          {prescriber.profile.registration_body.toUpperCase()}{' '}
          {prescriber.profile.registration_number}
        </span>
        {prescriber.profile.has_expired_licence ? (
          /*
           * AN EXPIRED LICENCE WARNS AND DOES NOT BLOCK, exactly as the model does: "Licence
           * currency is the clinic's regulatory responsibility, not ours. Blocking care on our
           * possibly-stale copy would be the worse error."
           */
          <span className="fine note-warn">
            The practising licence the clinic recorded has expired. Carevelo records what the
            clinic told it and verifies nothing — check your own registration.
          </span>
        ) : null}
        <span className="fine">
          Recorded by the clinic and never verified. Carevelo has no access to the UMDPC, AHPC
          or Nurses &amp; Midwives registers.
        </span>
      </Stack>
    )
  }

  return (
    <Stack gap="1">
      {/* The same 600 as above, for the same reason. */}
      <span style={{ fontWeight: 600 }}>
        {prescriber.kind === 'unreadable' ? prescriber.name : 'You'}
      </span>
      <span className="fine note-warn">
        The document will carry the registration body and number the clinic recorded for you.
        This console cannot read them back — that endpoint is open to administrators only — so
        it cannot show you the exact line before you sign it. If you are not certain what the
        clinic has on file, ask an administrator before issuing.
      </span>
    </Stack>
  )
}
