import { getTranslations } from 'next-intl/server'
import { Notice } from '@carevelo/ui'

/**
 * The clinic's emergency guidance, standing on the interface and never dismissible.
 *
 * REQUIRED, AND THE WORDING IS THE REQUIREMENT. H3's exception paths: "The interface
 * carries persistent, clinic-configurable emergency guidance. Carevelo makes no triage
 * decision and must never appear to." Both halves are load-bearing.
 *
 *   PERSISTENT — it is on the lobby and on the room, it has no close button, and it is
 *   rendered by the server so it is present before any script is. `<Notice>` has no
 *   dismiss affordance by construction: "a disclosure with an X on it is a disclosure that
 *   was not read."
 *
 *   THE CLINIC'S, NOT OURS — every sentence is attributed to the clinic by name and says
 *   what the clinic asks. Carevelo does not assess anybody. There is deliberately no list
 *   of symptoms that "count", no "if in doubt we recommend", and no branch on anything the
 *   patient tells us: the moment this page appears to sort a presentation into urgent and
 *   not urgent, Carevelo is triaging, which is practising medicine on a licence it does
 *   not hold. What is here is one instruction — go, now, to a facility — which is not a
 *   clinical judgement about this patient.
 *
 * CLINIC-CONFIGURABLE, WITH ONE HONEST CAVEAT. `guidance` overrides the default entirely,
 * for the clinic that has written its own. TenantResource carries no such field today —
 * branding, contact, timezone and currency, and nothing else — so nothing passes it yet
 * and the default stands. The prop exists so that adding the field is a change to the
 * route that supplies it and to nothing here.
 *
 * TWO WHOLE SENTENCES, NOT ONE WITH A TAIL GLUED ON. The version with a phone number and
 * the version without are separate messages, because "or call {clinic} on {phone}" handed
 * to a translator on its own is a fragment with no visible subject — and this is the one
 * paragraph in this domain where an awkward join could cost somebody the seconds it takes
 * to understand it. src/app/terms/page.tsx makes the same split for the same reason.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md — exception paths, emergency presentation
 */
export async function EmergencyGuidance({
  clinic,
  phone,
  guidance,
}: {
  clinic: string
  /** The clinic's own number. Absent is ordinary — not every tenant has published one. */
  phone?: string | undefined
  /** The clinic's own wording, when it has one, replacing everything below. */
  guidance?: string | undefined
}) {
  const t = await getTranslations('Consultations')

  return (
    /*
     * `announce={false}` on a tone that would otherwise take role="alert". This is a
     * standing disclosure and not an error, and the room re-renders itself while the
     * patient is sitting in it — an emergency notice that re-announced on every refresh
     * would be noise, and noise is what buries the alert that matters.
     */
    <Notice tone="bad" icon="heart" title={t('emergencyTitle')} announce={false}>
      {guidance
        ? guidance
        : phone
          ? t.rich('emergencyWithPhone', { clinic, phone, b: (chunks) => <b>{chunks}</b> })
          : t.rich('emergency', { clinic, b: (chunks) => <b>{chunks}</b> })}
    </Notice>
  )
}
