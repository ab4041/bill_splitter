import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/split'
import { type Balance, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

describe('splitCents', () => {
  it('hands the remainder out one cent at a time from the front', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333])
    expect(splitCents(2, 5)).toEqual([1, 1, 0, 0, 0])
  })

  it('always sums to the total', () => {
    for (const [total, count] of [
      [1, 7],
      [99999, 13],
      [Number.MAX_SAFE_INTEGER, 3],
    ] as const) {
      expect(splitCents(total, count).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('rejects bad input', () => {
    expect(() => splitCents(0, 3)).toThrow(RangeError)
    expect(() => splitCents(10.5, 3)).toThrow(RangeError)
    expect(() => splitCents(10, 0)).toThrow(RangeError)
  })
})

describe('input safety', () => {
  it.each([undefined, '', '   ', 5, null])('rejects home name %j', async (name) => {
    const created = await call('POST', '/api/homes', { body: { name } })
    expect(created.status).toBe(422)
    expect(created.body).toEqual({ error: expect.any(String) })
  })

  it('answers 400 JSON for a malformed body', async () => {
    const response = await call('POST', '/api/homes', { body: undefined })
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: expect.any(String) })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, [], {}])(
    'rejects the amount %j',
    async (totalCents) => {
      const { homeId } = await createHome(['Asha'])
      const bill = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })
      expect(bill.status).toBe(422)
    },
  )

  it('rejects a blank title', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title: '  ', totalCents: 100 },
    })
    expect(bill.status).toBe(422)
  })

  it('returns a JSON error for unknown routes', async () => {
    const response = await call('GET', '/api/nope')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })
})

describe('payments under concurrency', () => {
  it('lets exactly one of many different keys pay the same share', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('no share')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(bill.body.id, share.id, crypto.randomUUID())),
    )

    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 409)).toHaveLength(9)
    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
  })

  it('answers every concurrent retry with the same key identically', async () => {
    const { billId, shareId } = await (async () => {
      const { homeId } = await createHome(['Asha'])
      const bill = await createBill(homeId, 700)
      return { billId: bill.body.id, shareId: bill.body.shares[0]?.id ?? '' }
    })()
    const key = crypto.randomUUID()

    const results = await Promise.all(Array.from({ length: 8 }, () => pay(billId, shareId, key)))

    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.paidAt)).size).toBe(1)
  })

  it('does not let a share be paid through the wrong bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const billA = await createBill(homeId, 100)
    const billB = await createBill(homeId, 200)
    const shareOfA = billA.body.shares[0]
    if (!shareOfA) throw new Error('no share')

    const paid = await pay(billB.body.id, shareOfA.id, crypto.randomUUID())

    expect(paid.status).toBe(404)
  })
})

describe('bills listing', () => {
  it('lists bills of a home with their shares, newest first', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 100)
    const second = await createBill(homeId, 200)

    const listed = await call<{ bills: { id: string; shares: Share[] }[] }>(
      'GET',
      `/api/homes/${homeId}/bills`,
    )

    expect(listed.status).toBe(200)
    expect(listed.body.bills).toHaveLength(2)
    expect(listed.body.bills[0]?.id).toBe(second.body.id)
    expect(listed.body.bills[0]?.shares).toHaveLength(2)
  })
})
