import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Button, Card, Icon, Notice, Stack } from '@carevelo/ui'
import { prescriptionDocumentLink } from '../api/prescriptions'
import { localPath } from './localPath'

/**
 * "Open the written prescription" — a button that fetches a five-minute link and sends
 * the patient straight to it.
 *
 * WHY THE LINK IS NEVER RENDERED INTO THIS PAGE. The signed URL is a bearer credential
 * for special-category health data: whoever holds it reads the document, with no further
 * authentication. `PrescriptionDocuments::LINK_TTL_SECONDS` is 300 seconds — "short
 * enough that a link forwarded into a family WhatsApp group is already dead when it
 * arrives" — and that only holds if the clock starts when the patient presses the button.
 * An `<a href>` baked into the HTML starts expiring while the page is still being read,
 * and lives on in every cache, screenshot and browser-history entry of that page.
 *
 * So it is a FORM, posting to a Server Action, which asks the API and redirects. Which
 * also means it works with no JavaScript at all: a native form post, an HTTP redirect, and
 * the document opens. The patient this is built for is on a mid-range Android handset on
 * variable mobile data, and a document they cannot open because a bundle stalled is a
 * prescription they cannot take to a pharmacy.
 *
 * THE 202 IS NOT AN ERROR. The document is produced by a queued job; while that job runs
 * the endpoint answers `{"status":"rendering"}`, and a screen that called that a failure
 * would tell a patient their prescription was unavailable when it was seconds away.
 */
export async function PrescriptionDocument({
  prescriptionId,
  clinic,
  selfHref,
  state,
}: {
  prescriptionId: string
  clinic: string
  /**
   * This page's own path. The action has to send the patient somewhere when there is no
   * document to open yet, and a Server Action does not know the URL it was posted from.
   */
  selfHref: string
  /** What the last attempt produced, read back off the query string by the route. */
  state?: 'rendering' | 'unavailable' | undefined
}) {
  const t = await getTranslations('Prescriptions')

  return (
    <Card as="section" aria-labelledby="prescription-document" padding="tight">
      <Stack gap="4">
        <h2 id="prescription-document" className="stat__value stat__value--sm">
          {t('documentHeading')}
        </h2>

        <p className="muted">{t('documentBody', { clinic })}</p>

        {state === 'rendering' ? (
          <Notice tone="info" icon="clock" title={t('documentRenderingTitle')}>
            {t('documentRenderingBody', { clinic })}
          </Notice>
        ) : null}

        {state === 'unavailable' ? (
          <Notice tone="bad" title={t('documentFailedTitle')}>
            {t('documentFailedBody', { clinic })}
          </Notice>
        ) : null}

        <form action={openPrescriptionDocument}>
          <input type="hidden" name="prescription" value={prescriptionId} />
          <input type="hidden" name="back" value={selfHref} />
          {/* `brand`, not `primary`: this is a patient surface, so it paints with the
              CLINIC's colour and takes its foreground from --brand-primary-fg, which the
              backend computed for WCAG AA against that colour. */}
          <Button variant="brand" type="submit">
            <Icon name="file" /> {t('documentOpen')}
          </Button>
        </form>
      </Stack>
    </Card>
  )
}

/**
 * Ask for the link, then leave.
 *
 * Nothing about the document — not the URL, not the hash, not the expiry — is returned to
 * the page. The only outcome that reaches the browser is a redirect: to the document when
 * there is one, or back here with a word saying why not.
 */
async function openPrescriptionDocument(formData: FormData): Promise<void> {
  'use server'

  const id = String(formData.get('prescription') ?? '').trim()
  const back = localPath(String(formData.get('back') ?? ''))

  if (id === '') {
    redirect(`${back}?document=unavailable`)
  }

  const link = await prescriptionDocumentLink(id)

  if (link.status === 'ready') {
    // Straight to the signed URL. The API authorised the read before any URL existed, so
    // this is the only route to the bytes — there is no public path to fall back to.
    redirect(link.url)
  }

  redirect(`${back}?document=${link.status === 'rendering' ? 'rendering' : 'unavailable'}`)
}
