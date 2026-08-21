import type { Metadata } from 'next'
import { NewPasswordScreen } from '@/domains/identity'
import { IDENTITY_PATHS } from '../paths'

/**
 * Choosing a password — the screen an account carrying `password_change_required` is held
 * on until it does.
 *
 * UNDER `/sign-in` BECAUSE IT IS PART OF THE WAY IN. Somebody here has a session and yet
 * the API is refusing every call but this one, so they are not in the console; the address
 * bar should say so, and the screen renders the same full-bleed layout rather than the
 * console frame.
 *
 * Thin, as every route here is: it hands over the paths and the search parameters and
 * decides nothing. Whether the person is being forced or came here on purpose is read from
 * `GET /v1/me` by the domain, which is the only thing that knows.
 */
export const metadata: Metadata = { title: 'Choose a password' }

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; changed?: string | string[] }>
}) {
  const params = await searchParams

  return (
    <NewPasswordScreen paths={IDENTITY_PATHS} error={params.error} changed={params.changed} />
  )
}
