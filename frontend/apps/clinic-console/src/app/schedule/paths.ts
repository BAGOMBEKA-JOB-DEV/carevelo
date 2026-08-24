import type { SchedulePaths } from '@/domains/scheduling'

/**
 * WHERE THE SCHEDULING AND CONSULTATION SCREENS ARE MOUNTED.
 *
 * Every one of those domains hard-codes no URL. They take a paths object and build every link
 * and every post-submit redirect from it, which buys two things:
 *
 *   - a domain can be mounted anywhere, or twice, without editing it;
 *   - A SERVER ACTION CAN NEVER BE TALKED INTO REDIRECTING SOMEWHERE A FORM TOLD IT TO. The
 *     one thing an action must never do is take its destination from the request, and the way
 *     to make that impossible rather than merely avoided is to give the action no way to know
 *     a URL except through a value the server closed over.
 *
 * IN THE ROUTE LAYER, WHICH IS THE ONLY PLACE THAT KNOWS THESE. `src/app` owns the URL space;
 * a domain that knew `/schedule` would be a domain with an opinion about routing.
 *
 * `no-orphans` in .dependency-cruiser.cjs exempts `src/app/**` because Next discovers routes by
 * filename — which also covers this file, imported only by the routes beside it.
 */
export const SCHEDULE_PATHS: SchedulePaths = {
  day: '/schedule',
  book: '/schedule/book',
  /*
   * ENCODED, ONCE, HERE. A ULID needs no escaping today, but the identifier arrives from an
   * API response and building a path by concatenation is the habit that eventually meets a
   * value that does.
   */
  room: (appointmentId: string) => `/schedule/room/${encodeURIComponent(appointmentId)}`,
}
