import { readClient, writeClient } from './http'
import type { WeekChanges, WorkingHour } from '../model/types'

/**
 * When the clinic is open.
 *
 * These hours are the raw material for `/availability`: get them wrong and the clinic
 * publishes slots nobody staffs, and the first anyone knows is a patient at a locked door.
 * They are not patient-facing — a patient asks `/availability`, which answers the question
 * they actually have — so this is the only screen in the product where the timetable
 * itself is visible.
 */

export async function listWorkingHours(): Promise<WorkingHour[]> {
  const client = await readClient()
  const response = await client.get<{ data: WorkingHour[] }>('/v1/working-hours')

  return response.data
}

/**
 * Replace the whole week.
 *
 * PUT ON A COLLECTION, so the body IS the timetable rather than a patch, and a day that is
 * absent is DELETED. `model/week.ts` builds all seven days on every submission for that
 * reason; a merge-style update would leave last season's Saturday quietly published for as
 * long as nobody noticed.
 */
export async function replaceWorkingHours(week: WeekChanges): Promise<WorkingHour[]> {
  const client = await writeClient()
  const response = await client.put<{ data: WorkingHour[] }>('/v1/working-hours', week)

  return response.data
}
