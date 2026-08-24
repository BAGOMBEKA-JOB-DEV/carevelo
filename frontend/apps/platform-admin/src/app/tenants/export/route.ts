import { NextResponse, type NextRequest } from 'next/server'
import { authoriseOperator } from '@/domains/identity'
import { exportTenant } from '@/domains/platform'
import { PLATFORM_PATHS } from '../../paths'

/**
 * The controller-obligation export, turned into a file the operator can hand to the clinic.
 *
 * ============================================================
 * WHY THIS IS A ROUTE HANDLER AND NOT A SERVER ACTION
 * ============================================================
 *
 * A Server Action cannot hand a file back to a browser that posted natively, and this
 * surface ships no client JavaScript — there is no `saveAs`, no blob and no download
 * attribute to reach for. A route handler can answer with the document and a
 * `Content-Disposition`, which a plain form POST downloads without a line of script.
 *
 * ============================================================
 * WHY IT ACCEPTS POST AND NOTHING ELSE
 * ============================================================
 *
 * The export is audited TWICE on purpose: once in the platform trail, and once in the
 * CLINIC's own, so the clinic can see that it happened even when somebody else asked for it.
 * A GET would therefore be dangerous in an ordinary way — a link a browser prefetched, a
 * crawler followed, or an operator's history restored would write audit entries into a
 * clinic's own trail that nobody asked for, and those entries are permanent and
 * unfalsifiable by design.
 *
 * There is no `GET` export here for the same reason there is no `DELETE` anywhere on this
 * surface: a method that changes something must not be reachable by navigation.
 *
 * ============================================================
 * THE ORIGIN CHECK, AND WHAT IT IS AND IS NOT FOR
 * ============================================================
 *
 * A route handler gets none of the CSRF protection Next applies to Server Actions, so a form
 * on any site could POST here and an operator's browser would send their session cookie with
 * it. The attacker could not READ the response — a form-POST navigation downloads to the
 * victim's machine and same-origin policy keeps the body away from the attacker — so this is
 * not a data-exfiltration hole. What it is, is a way for a third party to write entries into
 * a clinic's permanent audit trail, and to hand an operator a file they did not ask for.
 *
 * So the request must carry an `Origin` matching this app's own. That header is set by the
 * browser on every cross-site form POST and cannot be forged by page script.
 *
 * A REQUEST WITH NO ORIGIN AT ALL IS REFUSED. Some very old clients omit it on same-origin
 * POSTs; refusing them costs an unusual browser an export and accepting them would leave the
 * check open to anything that simply declines to send the header. On a surface whose session
 * can authorise a break-glass grant, that trade goes the strict way.
 *
 * ============================================================
 * THE EXPORT IS AVAILABLE IN EVERY STATE, INCLUDING SUSPENDED
 * ============================================================
 *
 * There is no status check here and there must never be one. The clinic is the data
 * controller and leaves with its data REGARDLESS of any commercial dispute; withholding it
 * to secure payment would be unlawful and would harm patients. The only gate is the role.
 *
 * @see docs/50-security-compliance/data-retention-and-deletion.md
 */

/** Back to the register with something the operator can read, on any failure. */
function back(request: NextRequest, tenant: string, problem: string, message?: string | null) {
  const url = new URL(PLATFORM_PATHS.register, request.nextUrl.origin)

  url.searchParams.set('tenant', tenant)
  url.searchParams.set('problem', problem)

  if (message) {
    url.searchParams.set('message', message)
  }

  // 303, not 302: the browser must follow this with a GET. A 302 after a POST leaves older
  // clients free to repeat the POST, and repeating this one writes a second audit entry into
  // a clinic's trail for one operator action.
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')

  if (origin === null || origin !== request.nextUrl.origin) {
    // Deliberately terse and deliberately not a redirect. Nothing legitimate reaches this
    // branch, so there is no operator to help — and a helpful page here would be a page that
    // told a third-party site what to fix.
    return new NextResponse('Cross-site request refused.', { status: 403 })
  }

  const access = await authoriseOperator()

  if (access.kind !== 'operator' || !access.can.exportTenantData) {
    return new NextResponse('Not permitted.', { status: 403 })
  }

  const form = await request.formData()
  const tenant = String(form.get('tenant') ?? '').trim()

  if (tenant === '') {
    return back(request, '', 'incomplete')
  }

  const outcome = await exportTenant(tenant)

  if (outcome.kind === 'problem') {
    return back(request, tenant, 'export_failed', outcome.message)
  }

  /*
   * The document, pretty-printed. This file is handed to a clinic and read by people rather
   * than only by machines, and two kilobytes of whitespace is a fair price for something a
   * controller can actually inspect. `format` inside it identifies the shape —
   * `carevelo.tenant-export.v1` — so the file remains identifiable long after this app is
   * forgotten.
   */
  const body = JSON.stringify({ data: outcome.document }, null, 2)

  /*
   * The slug comes from the export document itself rather than from the form, and it is
   * stripped to a conservative alphabet before it goes anywhere near a header. A filename is
   * a header value: a newline or a quote in it is header injection, and the value here
   * originates in a text field a clinic filled in.
   */
  const slug = outcome.document.tenant.slug.replace(/[^a-zA-Z0-9-]/g, '') || 'tenant'
  const day = outcome.document.exported_at.slice(0, 10).replace(/[^0-9-]/g, '')

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="carevelo-export-${slug}-${day}.json"`,
      // This is a clinic's own records leaving the building. Nothing caches it, anywhere.
      'Cache-Control': 'no-store',
    },
  })
}
