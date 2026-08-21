import { NextResponse, type NextRequest } from 'next/server'
import { exportReconciliation } from '@/domains/payments'

/**
 * The reconciliation CSV, handed to the browser as a download.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS A ROUTE HANDLER AND NOT A LINK STRAIGHT TO THE API
 *
 * Because the API is not reliably on this origin. In production it shares a host with the
 * console and a direct link would work; locally, and anywhere the two are deployed apart,
 * `NEXT_PUBLIC_API_ORIGIN` differs by port or host — and a browser sending a cross-origin
 * GET does not attach the session cookie, so the clinic would get a 401 rendered as a
 * mysterious blank download. Going through this handler means the request is made
 * server-side by the same transport every other read in this section uses, with the session
 * copied onto it by hand.
 *
 * ------------------------------------------------------------------
 * WHY A ROUTE HANDLER IS ALLOWED TO EXIST HERE AT ALL
 *
 * `routes-hold-no-logic` forbids a domain importing from `src/app`, not the reverse. This
 * file makes no decisions about payments: it reads two query parameters, calls one exported
 * domain function, and turns the result into an HTTP response. The 92-day cap, the column
 * names, the audit event the export writes and the refusal to include a total are all the
 * API's, and the passing-through is all this file does.
 *
 * ------------------------------------------------------------------
 * THE FILENAME IS THE BACKEND'S
 *
 * `Content-Disposition` is passed through verbatim rather than rebuilt here. The backend
 * names the file `payment-records-<from>-to-<to>.csv`, and a second copy of that format in
 * this file would drift from it — leaving a clinic with two differently-named files
 * containing the same records and no way to tell which is which. The fallback below applies
 * only when the header is missing entirely.
 *
 * `X-Content-Type-Options: nosniff` is set again on the way out. The API sets it; this
 * response is a new one, and a CSV that a browser feels free to sniff as HTML is a stored
 * XSS vector wearing a spreadsheet's clothes.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const query = request.nextUrl.searchParams
  const from = query.get('from')
  const to = query.get('to')

  if (from === null || to === null) {
    return refuse('Choose a first and last day to export.')
  }

  const result = await exportReconciliation(from, to)

  if (!result.ok) {
    /*
     * Back to the screen with a sentence, rather than a bare status page. The person clicked
     * "Download CSV" and is looking at a form they can correct — the API's own message ("Export
     * at most 92 days at a time…") is the useful thing to put in front of them, and a browser
     * showing raw problem+json is a support call.
     */
    return refuse(result.message ?? 'The export did not complete. Try again in a moment.')
  }

  return new NextResponse(result.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': result.contentDisposition ?? 'attachment; filename="payment-records.csv"',
      'X-Content-Type-Options': 'nosniff',
      // A clinic's commercial records must never sit in a shared cache.
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Send the person back to the screen they came from, carrying the reason.
 *
 * A RELATIVE `Location` AND A HAND-BUILT RESPONSE, rather than `NextResponse.redirect()`.
 * That helper requires an ABSOLUTE URL, which would mean either trusting a request header to
 * tell this handler its own origin — the sort of thing an open redirect is built out of — or
 * hard-coding an origin that is wrong in every environment but one. A relative Location is
 * resolved by the browser against the origin it just asked, which is exactly right and
 * cannot be pointed anywhere else.
 *
 * 303 rather than 302: the browser must follow it with a GET. This was already a GET, so the
 * distinction is academic today and would stop being academic the moment somebody turns the
 * export form into a POST.
 *
 * The path is a literal in this file and the message is encoded, so there is nothing here an
 * open redirect could be built out of.
 */
function refuse(message: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `/payments/reconciliation?exportProblem=${encodeURIComponent(message)}`,
      'Cache-Control': 'no-store',
    },
  })
}
