import type { StorePrescriptionBody } from './types'

/**
 * One line of a prescription, as the clinician types it and as the API accepts it.
 *
 * ====================================================================================
 * CAREVELO DOES NOT CLASSIFY MEDICINES, AND `is_controlled` IS THE CLINICIAN'S FLAG
 * ====================================================================================
 *
 * `StorePrescriptionRequest` is explicit: "Controlled items are flagged by the clinician.
 * Carevelo does not classify medicines — doing so would be a clinical judgement it has no
 * standing to make." So there is no lookup table here, no autocomplete against a formulary,
 * and no inference from a medicine's name. The clinician ticks the box.
 *
 * The consequence of that tick is real and the form says so where it is ticked: a controlled
 * item is excluded from delivery entirely and requires in-person handling at the pharmacy.
 * A clinician who does not know that will not tick it.
 *
 * QUANTITY IS AN INTEGER AND IS NOT MONEY. Nothing in this domain touches a price: the
 * clinic's own pharmacy prices the dispense order, in whole minor units, on its own screen.
 * A prescription carries no amount at all.
 */
export type DraftItem = {
  medicineName: string
  form: string
  strength: string
  quantity: string
  unit: string
  directions: string
  isControlled: boolean
}

/** How many lines the form offers. Enough for a real prescription; not a spreadsheet. */
export const MAX_ITEMS = 8

export function emptyItem(): DraftItem {
  return {
    medicineName: '',
    form: '',
    strength: '',
    quantity: '',
    unit: '',
    directions: '',
    isControlled: false,
  }
}

/** A line the clinician has actually started filling in. Blank rows are ignored, never sent. */
export function isStarted(item: DraftItem): boolean {
  return item.medicineName.trim() !== '' || item.directions.trim() !== ''
}

export type ItemProblem = { index: number; message: string }

/**
 * What is wrong with the draft, in the clinician's terms.
 *
 * CHECKED HERE AND AGAIN BY THE API, and this copy exists only so the clinician is told before
 * the confirmation step rather than after it. `StorePrescriptionRequest` is the enforcement:
 * "A prescription with no items is not a clinical document."
 *
 * DIRECTIONS ARE REQUIRED AND THAT IS NOT A FORM RULE. A medicine name with no directions is
 * not a prescription — it is a shopping list, and the person who has to act on it is a
 * pharmacist who was not in the room.
 */
export function problemsWith(items: readonly DraftItem[]): ItemProblem[] {
  const problems: ItemProblem[] = []
  const started = items.filter(isStarted)

  if (started.length === 0) {
    return [{ index: 0, message: 'A prescription needs at least one medicine.' }]
  }

  items.forEach((item, index) => {
    if (!isStarted(item)) {
      return
    }

    if (item.medicineName.trim() === '') {
      problems.push({ index, message: 'Name the medicine.' })
    }

    if (item.directions.trim() === '') {
      problems.push({
        index,
        message: 'Say how it is to be taken. A pharmacist who was not in the room reads this.',
      })
    }

    const quantity = Number(item.quantity)

    if (!Number.isInteger(quantity) || quantity <= 0) {
      problems.push({ index, message: 'Quantity must be a whole number greater than zero.' })
    }
  })

  return problems
}

/**
 * The draft, as the API accepts it.
 *
 * OPTIONAL FIELDS ARE OMITTED RATHER THAN SENT EMPTY. `form`, `strength` and `unit` are
 * nullable on the contract, and an empty string is not the same as an absent value on a
 * document somebody reads: "500" with an empty unit prints differently from "500" with no unit
 * field at all, and the second is what "not stated" means.
 */
export function toBody(consultationId: string, items: readonly DraftItem[]): StorePrescriptionBody {
  return {
    consultation_id: consultationId,
    items: items.filter(isStarted).map((item) => ({
      medicine_name: item.medicineName.trim(),
      ...(item.form.trim() === '' ? {} : { form: item.form.trim() }),
      ...(item.strength.trim() === '' ? {} : { strength: item.strength.trim() }),
      quantity: Number(item.quantity),
      ...(item.unit.trim() === '' ? {} : { unit: item.unit.trim() }),
      directions: item.directions.trim(),
      is_controlled: item.isControlled,
    })),
  }
}

/**
 * The line as it will read on the document.
 *
 * ONE FUNCTION, USED BY THE CONFIRMATION AND BY NOTHING ELSE, because "exactly what will
 * appear on the PDF" has to be assembled somewhere and two assemblies would eventually
 * disagree. When the rendered document's own layout changes, this is the line to change with
 * it — and if it drifts, the confirmation is showing a clinician something they did not sign.
 */
export function documentLine(item: DraftItem): string {
  const name = [item.medicineName.trim(), item.strength.trim(), item.form.trim()]
    .filter((part) => part !== '')
    .join(' ')

  const amount = [item.quantity.trim(), item.unit.trim()].filter((part) => part !== '').join(' ')

  return `${name} — ${amount} — ${item.directions.trim()}`
}
