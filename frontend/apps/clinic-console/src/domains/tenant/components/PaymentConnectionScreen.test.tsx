import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AggregatorAccount, TenantPaths } from '../model/types'

/**
 * THE PARTS OF THIS SCREEN A BROWSER WALK CANNOT REACH.
 *
 * ====================================================================================
 * WHY THIS FILE EXISTS AT ALL, WHEN THE SCREEN WAS DRIVEN IN A REAL BROWSER
 * ====================================================================================
 *
 * It was, and the walk found what a walk finds: the provider selector navigates, the field
 * labels change with it, the browser's `required` follows the aggregator rather than the
 * API, and the Server Action refuses a half credential pair with the attribute stripped
 * off. All of that is reachable because the demo clinic is `unconfigured`, which is the
 * state it ships in and the state §H1.6 makes a working one.
 *
 * WHAT IS NOT REACHABLE IS EVERYTHING ON THE OTHER SIDE OF A CONNECTED ACCOUNT. There is
 * no endpoint that disconnects one, so seeing the connected panels in a browser means
 * writing a merchant account for a real clinic into a shared development database — which
 * is a one-way door, on a row the payment code reads, while another agent is migrating the
 * table underneath it. The cost of not doing that is this file, and it is the cheaper of
 * the two: the connected states are asserted here on every run rather than looked at once.
 *
 * ====================================================================================
 * AND ONE OF THEM CANNOT BE REACHED FROM ANY DATABASE STATE TODAY
 * ====================================================================================
 *
 * `AggregatorAccountResource` enumerates seven fields and none of them says whether Pesapal
 * has a notification URL registered for the clinic. Until it does, `ipnRegistration()`
 * answers `not_reported`, and the whole point of that answer is that the console does not
 * fill the gap with a reassurance it cannot support. The three-way branch is asserted below
 * so that the day the field appears, the two states that were previously unreachable are
 * already covered — and so that a change which quietly defaults the missing field to
 * "registered" fails here rather than in a clinic.
 *
 * ====================================================================================
 * THE ONE INVARIANT THAT IS WORTH MORE THAN THE REST OF THIS FILE
 * ====================================================================================
 *
 * `no credential is ever rendered back` is acceptance criterion 3 and the reason the
 * resource, the policy and the model's `$hidden` all say the same thing three times. This
 * asserts the fourth: that every box in the form opens empty on a CONNECTED account, where
 * a well-meaning change would most plausibly try to be helpful.
 */

const PATHS: TenantPaths = {
  hub: '/settings',
  branding: '/settings/branding',
  compliance: '/settings/compliance',
  services: '/settings/services',
  hours: '/settings/hours',
  staff: '/settings/staff',
  staffMember: '/settings/staff/{user}',
  payments: '/settings/payments',
}

const getAggregatorAccount = vi.fn<() => Promise<AggregatorAccount>>()

/*
 * `api/http` is mocked wholesale rather than partially: it reaches for `next/headers`, and
 * the module is evaluated on import whether or not a test ever calls into it. `attempt` is
 * reimplemented here to the letter of its own contract — an `ok` envelope, never a throw —
 * because a stub that resolved differently would be testing the stub.
 */
vi.mock('../api/http', () => ({
  attempt: async (work: Promise<unknown>) => {
    try {
      return { ok: true as const, value: await work }
    } catch (error) {
      return { ok: false as const, status: 0, message: String(error) }
    }
  },
  writeFailure: (_error: unknown, what: string) => `Something went wrong ${what}.`,
}))

vi.mock('../api/aggregator', () => ({
  getAggregatorAccount: () => getAggregatorAccount(),
  saveAggregatorCredentials: vi.fn(),
  verifyAggregatorAccount: vi.fn(),
}))

const { PaymentConnectionScreen } = await import('./PaymentConnectionScreen')

/** An account in whatever state a test needs, with the API's own defaults around it. */
function account(overrides: Partial<AggregatorAccount> & Record<string, unknown> = {}): AggregatorAccount {
  return {
    provider: 'flutterwave',
    status: 'unconfigured',
    environment: 'sandbox',
    last_verified_at: null,
    accepts_online_payment: false,
    fallback:
      'Appointments and dispensing continue on pay-at-clinic whenever online collection is '
      + 'unavailable.',
    credentials_are_write_only: true,
    ...overrides,
  } as AggregatorAccount
}

async function show(provider?: string) {
  const ui = await PaymentConnectionScreen(
    provider === undefined ? { paths: PATHS } : { paths: PATHS, provider },
  )

  return render(ui)
}

beforeEach(() => {
  getAggregatorAccount.mockReset()
})

/*
 * EXPLICIT, because testing-library's automatic cleanup is not registered here. It hooks
 * itself onto a global `afterEach`, which exists only when vitest runs with `globals: true`
 * — and this workspace deliberately does not, so every render would otherwise stay in
 * `document.body` and the next test would query a page made of three screens. That is not a
 * hypothetical: it is how this file failed the first time it ran, with `queryByLabelText`
 * finding the previous test's "Public key" on a panel that no longer offers one.
 */
afterEach(cleanup)

describe('the aggregator a clinic is being asked about', () => {
  it('asks for a secret key by default, which is what Flutterwave issues', async () => {
    getAggregatorAccount.mockResolvedValue(account())

    await show()

    expect(screen.getByLabelText('Secret key')).toBeTruthy()
    expect(screen.getByLabelText('Public key')).toBeTruthy()
    expect(screen.queryByLabelText('Consumer key')).toBeNull()
  })

  it('asks for a consumer key and secret when Pesapal is selected, because that is what Pesapal issues', async () => {
    getAggregatorAccount.mockResolvedValue(account())

    await show('pesapal')

    expect(screen.getByLabelText('Consumer secret')).toBeTruthy()
    expect(screen.getByLabelText('Consumer key')).toBeTruthy()
    expect(screen.queryByLabelText('Public key')).toBeNull()
  })

  it('requires the consumer key for Pesapal and not for Flutterwave', async () => {
    getAggregatorAccount.mockResolvedValue(account())

    const flutterwave = await show()
    expect(flutterwave.container.querySelector('input[name="public_key"]')?.hasAttribute('required')).toBe(false)
    cleanup()

    const pesapal = await show('pesapal')
    expect(pesapal.container.querySelector('input[name="public_key"]')?.hasAttribute('required')).toBe(true)
  })

  it('posts the selected provider with the form, so a stale URL cannot save the wrong one', async () => {
    getAggregatorAccount.mockResolvedValue(account())

    const { container } = await show('pesapal')

    expect(container.querySelector('input[name="provider"]')?.getAttribute('value')).toBe('pesapal')
  })

  it('falls back to the connected provider when the URL names something that is not one', async () => {
    getAggregatorAccount.mockResolvedValue(
      account({ provider: 'pesapal', status: 'active', accepts_online_payment: true }),
    )

    await show('not-an-aggregator')

    expect(screen.getByLabelText('Consumer secret')).toBeTruthy()
  })
})

describe('Pesapal’s notification URL', () => {
  it('says Carevelo does not report it, rather than claiming it is registered', async () => {
    getAggregatorAccount.mockResolvedValue(
      account({ provider: 'pesapal', status: 'active', accepts_online_payment: true }),
    )

    await show()

    expect(screen.getByText('How Carevelo hears from Pesapal')).toBeTruthy()
    expect(screen.queryByText('Pesapal has a notification URL for this account')).toBeNull()
    expect(screen.queryByText('Pesapal has no notification URL for this account')).toBeNull()
  })

  it('says so plainly, and announces it, when the API reports none', async () => {
    getAggregatorAccount.mockResolvedValue(
      account({
        provider: 'pesapal',
        status: 'active',
        accepts_online_payment: true,
        ipn_registered: false,
      }),
    )

    await show()

    const notice = screen.getByRole('alert')
    expect(within(notice).getByText('Pesapal has no notification URL for this account')).toBeTruthy()
    /* The consequence, not just the state: a clinic that reads "unregistered" and nothing
       else has no way to know it matters. */
    expect(notice.textContent).toContain('sit unconfirmed')
  })

  it('confirms it when the API reports one', async () => {
    getAggregatorAccount.mockResolvedValue(
      account({
        provider: 'pesapal',
        status: 'active',
        accepts_online_payment: true,
        ipn_registered: true,
      }),
    )

    await show()

    expect(screen.getByText('Pesapal has a notification URL for this account')).toBeTruthy()
  })

  it('is absent for Flutterwave, which has no such registration', async () => {
    getAggregatorAccount.mockResolvedValue(
      account({ provider: 'flutterwave', status: 'active', accepts_online_payment: true }),
    )

    await show()

    expect(screen.queryByText('How Carevelo hears from Pesapal')).toBeNull()
  })
})

describe('an account that is not connected', () => {
  it('describes the state and where the clinic has to go, rather than leaving a blank panel', async () => {
    getAggregatorAccount.mockResolvedValue(account())

    await show()

    expect(screen.getByText('No merchant account is connected')).toBeTruthy()
    /* The bit an administrator cannot guess, and the reason this is not a "finish setup"
       prompt: the first move is at the aggregator, and Carevelo is not allowed to make it. */
    expect(screen.getByText(/Carevelo cannot open one for you/)).toBeTruthy()
  })

  it('offers no verification, because there is nothing stored to verify', async () => {
    getAggregatorAccount.mockResolvedValue(account())

    await show()

    expect(screen.queryByRole('button', { name: /Check these credentials now/ })).toBeNull()
  })
})

describe('the credentials themselves', () => {
  it('opens every box empty on a connected account, because nothing can read one back', async () => {
    getAggregatorAccount.mockResolvedValue(
      account({
        provider: 'pesapal',
        status: 'active',
        environment: 'live',
        accepts_online_payment: true,
        last_verified_at: '2026-08-24T09:00:00+00:00',
      }),
    )

    const { container } = await show()

    for (const name of ['secret_key', 'public_key', 'webhook_secret', 'merchant_reference']) {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)

      expect(input, `${name} is on the form`).toBeTruthy()
      expect(input?.value, `${name} opens empty`).toBe('')
      expect(input?.getAttribute('value'), `${name} is not server-rendered with a value`).toBeNull()
    }
  })
})
