import { NextResponse } from 'next/server'

// TEMPORARY SCAFFOLD — deleted before this branch is handed back. It reproduces exactly
// what a Server Action's `redirect()` to a hosted checkout looks like on the wire for a
// browser with no JavaScript: a POST answered with a 303 whose Location is another origin.
export async function POST(): Promise<NextResponse> {
  return NextResponse.redirect(
    'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId=PESAPAL-TRACK-0001',
    303,
  )
}
