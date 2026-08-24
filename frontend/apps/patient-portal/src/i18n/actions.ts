'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from './locales'

/**
 * Remember the language a patient chose.
 *
 * A SERVER ACTION BEHIND A PLAIN FORM POST, because the binding constraint on this product
 * is a mid-range Android phone on variable mobile data, and the language control is the
 * one control a person who cannot read the current language has to be able to operate.
 * A <select> with an onChange handler is dead until the bundle arrives; a form posting to
 * this action submits natively before it does and with JavaScript switched off entirely.
 * Sign-in already works that way and this is the same shape.
 *
 * NO REDIRECT, AND NO PATHNAME IS THREADED THROUGH TO ALLOW ONE. Next posts the form to
 * the URL it was rendered on and re-renders that same URL afterwards, so the patient stays
 * exactly where they were — which is the behaviour you want when the whole point is to
 * re-read the page they are already on. Passing a path would mean every caller supplying
 * one and one caller eventually getting it wrong.
 *
 * WHAT `revalidatePath` IS FOR HERE, since nothing on this surface is cached on the
 * server: the CLIENT router cache. A patient with JavaScript who switches language and
 * then follows a link the router prefetched moments earlier would be handed the prefetched
 * ENGLISH page — a language switch that appears to half-work is worse than one that does
 * not work at all, because they will not press it twice. Invalidating from the root layout
 * down drops every prefetched entry.
 */
export async function chooseLocale(formData: FormData): Promise<void> {
  const requested = formData.get('locale')

  /*
   * A value that is not one of our two languages is dropped rather than stored. It cannot
   * reach a catalogue — negotiateLocale would fall back — but this is a value arriving
   * from a form and leaving again in a Set-Cookie header, and validating at the boundary
   * is cheaper than reasoning about every place it might later be read.
   */
  if (!isLocale(requested)) {
    return
  }

  const jar = await cookies()

  jar.set({
    name: LOCALE_COOKIE,
    value: requested,
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    /*
     * httpOnly even though this carries no authority whatsoever. Nothing client-side reads
     * the language — there is no client-side i18n on this surface at all, every string is
     * resolved on the server — so script access would be a capability granted for no
     * caller, and the theme cookie's opposite choice is not a precedent: theme-init.js
     * genuinely does have to read that one before the first paint.
     */
    httpOnly: true,
    sameSite: 'lax',
    // Locally the portal is plain http on a .localhost host, and a Secure cookie there is
    // a cookie the browser silently drops.
    secure: process.env.NODE_ENV === 'production',
  })

  revalidatePath('/', 'layout')
}
