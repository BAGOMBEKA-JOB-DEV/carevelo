import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Badge, Card, DateTime, Inline, Notice, Stack } from '@carevelo/ui'
import { SitePageHeader } from '@/components/SitePageHeader'
import { PrescriptionDocument } from './PrescriptionDocument'
import { statusTone, statusWord } from './status'
import type { PrescriptionItem, PrescriptionResult } from '../api/prescriptions'

/**
 * One prescription, in full: who wrote it, when, and exactly what to take.
 *
 * THERE IS NO EDIT AFFORDANCE ANYWHERE ON THIS SCREEN, AND THERE MUST NEVER BE ONE. Not a
 * pencil, not a "request a change", not a comment box. `PrescriptionPolicy::update()` and
 * `::delete()` both return `false` unconditionally, `routes/api.php` registers no PUT and
 * no PATCH, and the model's own comment says why: "A prescription is corrected by
 * cancelling it and issuing a replacement." A control that looked editable would be
 * promising a patient something the whole system is built to refuse — and on a clinical
 * record, "your change was not saved" is a materially dangerous message. The one thing
 * this screen does say, in as many words, is who to tell when something is wrong.
 *
 * THE CLINICIAN'S DETAILS ARE A SNAPSHOT, NOT A JOIN. `issued_by` carries the name and
 * registration recorded at the moment of issue, so a clinician who later leaves the clinic
 * does not change what this document says. It is shown with the attestation the
 * registration enum demands: Carevelo has no access to the UMDPC, AHPC or Nurses &
 * Midwives registers, no API exists to check one against, and "every surface showing it
 * must say so".
 *
 * A SERVER COMPONENT THROUGHOUT. Clinical content is shown in-app under authentication,
 * and this is that place — never a notification, and never anything that renders before
 * the session has been checked.
 */
export async function PrescriptionDetail({
  result,
  clinic,
  selfHref,
  backHref = '/prescriptions',
  documentState,
}: {
  result: PrescriptionResult
  /** The clinic's trading name. Resolved by the route, which already holds the tenant. */
  clinic: string
  /** This page's own path, for the document form to return to. */
  selfHref: string
  backHref?: string | undefined
  documentState?: 'rendering' | 'unavailable' | undefined
}) {
  const t = await getTranslations('Prescriptions')

  if (!result.ok) {
    return (
      /* The API's own sentence where there is one. It is phrased so that a record
         belonging to another clinic is indistinguishable from one that never existed —
         both are 404 — and a friendlier rewrite here would be the one thing that gives
         the difference away. */
      <Notice tone="bad" title={t('unavailableTitle')}>
        {result.message ?? t('unreachable', { clinic })}
      </Notice>
    )
  }

  const { prescription } = result
  const items = prescription.items

  // Resolved once rather than per row: a prescription can carry a dozen items, and each
  // of these is the same six strings. Also a hard requirement of the markup below — the
  // row renderer is synchronous, so it cannot await anything itself.
  const labels = {
    controlledBadge: t('controlledBadge'),
    controlledNote: t('controlledNote'),
    form: t('formLabel'),
    strength: t('strengthLabel'),
    quantity: t('quantityLabel'),
    directions: t('directionsLabel'),
  }

  return (
    <Stack gap="7">
      <div>
        {/* A left arrow as a character rather than an icon: it is decoration inside a
            link whose text already says where it goes, and the icon set's chevron only
            points right. */}
        <Link className="lnk" href={backHref}>
          {'\u2190'} {t('backToList')}
        </Link>
      </div>

      <SitePageHeader
        eyebrow={t('detailEyebrow')}
        title={prescription.issued_by.name}
        description={
          <>
            {t('issuedLabel')}{' '}
            {prescription.issued_at ? <DateTime value={prescription.issued_at} format="datetime" /> : '—'}
          </>
        }
        actions={
          <Badge tone={statusTone(prescription.status)}>{t(statusWord(prescription.status))}</Badge>
        }
      />

      {/* The status warnings come FIRST, above the medicines. A patient who reads the
          directions and then discovers the prescription was cancelled has already been
          given the wrong instruction. */}
      {prescription.status === 'cancelled' ? (
        <Notice tone="bad" title={t('cancelledTitle')}>
          {t('cancelledBody', { clinic })}
        </Notice>
      ) : null}

      {prescription.status === 'superseded' ? (
        <Notice tone="warn" icon="file" title={t('supersededTitle')}>
          {t('supersededBody')}
        </Notice>
      ) : null}

      {/* The other direction of the same fact: this one was written to replace an earlier
          prescription. Said plainly, because a patient holding two pieces of paper needs
          to know which is current — and the identifier itself is not shown, since it means
          nothing to them and the earlier record is in the same list. */}
      {prescription.supersedes_prescription_id === null ? null : (
        <p className="muted">{t('replacesNote')}</p>
      )}

      <Stack as="section" gap="4" aria-labelledby="prescription-items">
        {/* `.title` rather than `.stat__value` forced down to 21px by hand: `.title` IS the
            token layer's 21px heading step. A stat value is a FIGURE — display face,
            tabular numerals, sized to be read across a room — and this is a heading. */}
        <h2 id="prescription-items" className="title">
          {t('itemsHeading')}
        </h2>

        {items === undefined ? (
          /*
           * NOT AN EmptyState. `items` is absent when the relation was not loaded, which
           * is a transport problem — and "no medicines" is a sentence a patient would act
           * on. The two must never look the same on a clinical record.
           */
          <Notice tone="bad" title={t('itemsMissingTitle')}>
            {t('itemsMissingBody', { clinic })}
          </Notice>
        ) : (
          <Stack as="ul" gap="4">
            {items.map((item) => (
              <Item key={item.id} item={item} labels={labels} />
            ))}
          </Stack>
        )}
      </Stack>

      <PrescriptionDocument
        prescriptionId={prescription.id}
        clinic={clinic}
        selfHref={selfHref}
        state={documentState}
      />

      <Card as="section" aria-labelledby="prescription-issuer" padding="tight">
        <Stack gap="3">
          <h2 id="prescription-issuer" className="stat__label">
            {t('issuedByHeading')}
          </h2>

          {/* `.title-sm` — the display face's 17.5px step — where a stat value was being
              forced down to 19px. A clinician's name is a name, not a figure. */}
          <span className="title-sm">{prescription.issued_by.name}</span>

          <span className="muted tnum">
            {t('registrationLine', {
              body: prescription.issued_by.registration_body,
              number: prescription.issued_by.registration_number,
            })}
          </span>

          {/* The honest caveat, on the surface that shows the number rather than in a
              policy page nobody opens. */}
          <p className="fine">{t('attestation', { clinic })}</p>
        </Stack>
      </Card>

      {/* Last on the page, and deliberately not a warning: it is the answer to the
          question this screen raises by having no edit control on it. */}
      <Notice tone="neutral" icon="lock">
        {t('immutableNote', { clinic })}
      </Notice>
    </Stack>
  )
}

/**
 * One prescribed medicine.
 *
 * The controlled flag is shown as a WORD, not a colour: `is_controlled` decides whether
 * this order can ever be delivered, and the delivery screen refuses on the strength of it,
 * so a patient reading this page has to be able to see why before they get there.
 */
function Item({
  item,
  labels,
}: {
  item: PrescriptionItem
  labels: {
    controlledBadge: string
    controlledNote: string
    form: string
    strength: string
    quantity: string
    directions: string
  }
}) {
  return (
    <Card as="li" padding="tight">
      <Stack gap="3">
        <Inline gap="3">
          <span className="title-sm">{item.medicine_name}</span>

          {item.is_controlled ? (
            <Badge tone="warn" icon="shield">
              {labels.controlledBadge}
            </Badge>
          ) : null}
        </Inline>

        {/*
         * A definition list stays a definition list: form, strength, quantity and
         * directions are term/value pairs and a screen reader announces them as such.
         * `Stack`'s element union is the set of things a column is legitimately made of and
         * `dl` is not among them, so this keeps `.stack` — whose own gap is already
         * `--space-2`, which is why the hand-set gap could simply go. The surviving
         * `margin: 0` clears the user agent's `<dl>` margin: reset.css zeroes headings and
         * paragraphs, and deliberately leaves lists alone.
         */}
        <dl className="stack" style={{ margin: 0 }}>
          {item.form === null ? null : <Detail label={labels.form} value={item.form} />}
          {item.strength === null ? null : <Detail label={labels.strength} value={item.strength} />}
          <Detail
            label={labels.quantity}
            value={item.unit === null ? String(item.quantity) : `${item.quantity} ${item.unit}`}
          />
          <Detail label={labels.directions} value={item.directions} />
        </dl>

        {item.is_controlled ? <p className="fine">{labels.controlledNote}</p> : null}
      </Stack>
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Inline gap="3" align="baseline">
      {/* A 9-character floor on the term column, so Form, Strength, Quantity and Directions
          line their values up down the card instead of stepping in and out. A CONTENT
          measure in `ch`, not a distance between things — the space scale would be the
          wrong vocabulary for it, the same distinction Skeleton draws for its block
          heights. */}
      <dt className="stat__label" style={{ minWidth: '9ch' }}>
        {label}
      </dt>
      {/* Clears the user agent's 40px `<dd>` indent, which the reset does not cover.
          Without it every value sits inset from the term it belongs to. */}
      <dd className="grow" style={{ margin: 0 }}>
        {value}
      </dd>
    </Inline>
  )
}
