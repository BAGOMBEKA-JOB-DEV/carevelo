import { Card, DateTime, Notice } from '@carevelo/ui'
import type { Prescription } from '../model/types'

/**
 * Who prescribed this, and under which registration.
 *
 * ------------------------------------------------------------
 * THIS IS THE STAFF VIEW, AND IT SHOWS THE REGISTRATION NUMBER. §2 of the PRD is explicit:
 * "The pharmacist opens the order, sees the prescription with the prescribing clinician's
 * name and registration number." That is deliberately more than the patient's copy of the
 * same prescription carries — a pharmacist is deciding whether to dispense a controlled
 * medicine on somebody's authority, and "Dr Nabirye" is not an authority. A registration
 * number is what they would ask for over the counter.
 *
 * ------------------------------------------------------------
 * CAPTURED, NEVER VERIFIED — AND THE SCREEN HAS TO SAY SO.
 *
 * `RegistrationBody` in the contract carries the reasoning in full: "Carevelo has no
 * access to the UMDPC, AHPC or Nurses & Midwives registers and no API exists to check one
 * against, so the value a clinic records is its own attestation and every surface showing
 * it must say so."
 *
 * That last clause is why the notice below exists and why it is not collapsible. A
 * registration number rendered plainly, in a console, beside a clinical document, reads as
 * verified — and a pharmacist relying on a check we never performed is a worse outcome
 * than one who knows they are looking at an attestation. Automated licence verification is
 * explicitly out of scope; implying it would be worse than recording it honestly.
 *
 * The values are SNAPSHOTTED onto the prescription at issue, not joined from the
 * clinician's current record. So a clinician who has since left the clinic, or changed
 * their name, still reads here exactly as they did on the day — which is the property a
 * document a clinic may have to produce years later needs.
 */

/**
 * The three Ugandan registers, as `RegistrationBody` names them.
 *
 * The COLUMN is deliberately not cast to that enum on the backend, because the value is
 * snapshotted onto a document that has to reproduce exactly what was recorded — including
 * rows written before the enum existed and rows written in a different case. So this map
 * is a lookup with a fallback rather than an exhaustive `Record`, and an unrecognised value
 * is shown as itself. A pharmacist who sees an unfamiliar register can ring somebody; a
 * pharmacist who sees an error boundary cannot dispense at all.
 */
const REGISTERS: Record<string, string> = {
  umdpc: 'Uganda Medical and Dental Practitioners Council',
  ahpc: 'Allied Health Professionals Council',
  nurses_midwives: 'Uganda Nurses and Midwives Council',
}

export function PrescriberCard({ prescription }: { prescription: Prescription }) {
  const issuer = prescription.issued_by
  const register = REGISTERS[issuer.registration_body.toLowerCase()] ?? issuer.registration_body

  return (
    <Card as="section" aria-labelledby="prescriber">
      <div className="stack">
        <h2 id="prescriber">Prescribed by</h2>

        <dl className="grid g-2">
          <div className="stack">
            <dt className="stat__label">Clinician</dt>
            <dd>{issuer.name}</dd>
          </div>

          <div className="stack">
            <dt className="stat__label">Registration number</dt>
            {/* `.tnum` so a column of these does not shift width, and because a
                registration number is read digit by digit. */}
            <dd className="tnum">{issuer.registration_number}</dd>
          </div>

          <div className="stack">
            <dt className="stat__label">Register</dt>
            <dd>{register}</dd>
          </div>

          <div className="stack">
            <dt className="stat__label">Issued</dt>
            <dd>
              {prescription.issued_at ? (
                <DateTime value={prescription.issued_at} format="datetime" />
              ) : (
                <span className="muted">Not recorded</span>
              )}
            </dd>
          </div>
        </dl>

        <Notice tone="warn" title="Recorded by the clinic, not verified by Carevelo">
          Carevelo has no access to the UMDPC, AHPC or Nurses and Midwives registers and no
          API exists to check one against. This number is the clinic&rsquo;s own attestation,
          snapshotted when the prescription was issued. Treat it as you would a number read
          to you over the telephone.
        </Notice>

        {prescription.supersedes_prescription_id ? (
          <Notice tone="info" title="This replaces an earlier prescription">
            An earlier prescription was superseded by this one. The earlier document still
            exists — a prescription is never edited, only replaced — so check that you are
            dispensing against this version.
          </Notice>
        ) : null}
      </div>
    </Card>
  )
}
