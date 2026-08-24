import { redirect } from 'next/navigation'
import { DELIVERY_PATHS } from '@/app/paths'

/**
 * The landing page, which is a redirect and now says so.
 *
 * IT USED TO BE A PLACEHOLDER, AND THE PLACEHOLDER LEFT A NOTE ASKING FOR EXACTLY THIS:
 * "NOT A REDIRECT TO /assignments, though that is where a rider is going. A redirect
 * would be the right call once there is an assignment list to redirect to." There is one.
 *
 * NO SESSION CHECK HERE. /assignments performs it, and duplicating the check would mean a
 * round trip to `GET /v1/me` purely to decide which redirect to issue — a request on
 * somebody's own metered bundle that changes nothing about where they end up. It leaks
 * nothing either way: the redirect is identical for a signed-in rider and for a stranger.
 */
export default function HomePage() {
  redirect(DELIVERY_PATHS.assignments)
}
