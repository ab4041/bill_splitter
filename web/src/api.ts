export type Member = { id: string; homeId: string; name: string }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Home = { id: string; name: string; members: Member[] }
export type Balance = { memberId: string; name: string; outstandingCents: number }

const REQUEST_TIMEOUT_MS = 10_000

export class ApiError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isErrorBody(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  )
}

/**
 * Every failure (network down, timeout, 500, HTML error page, bad JSON)
 * becomes an ApiError with a readable message, so callers never crash.
 */
async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal

  try {
    const response = await fetch(path, {
      method,
      signal,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      // Non-JSON body (for example a proxy error page). Handled below.
    }
    if (!response.ok) {
      const message = isErrorBody(payload) ? payload.error : `Request failed (${response.status})`
      throw new ApiError(message, response.status)
    }
    if (payload === null) throw new ApiError('The server sent an unreadable response', null)
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted) throw error // the caller cancelled on purpose
    if (timeout.signal.aborted) throw new ApiError('The server took too long to answer', null)
    throw new ApiError('Could not reach the server', null)
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  createHome: (name: string) =>
    request<{ id: string; name: string }>('POST', '/api/homes', { body: { name } }),
  getHome: (homeId: string, signal?: AbortSignal) =>
    request<Home>('GET', `/api/homes/${encodeURIComponent(homeId)}`, { signal }),
  addMember: (homeId: string, name: string) =>
    request<Member>('POST', `/api/homes/${encodeURIComponent(homeId)}/members`, { body: { name } }),
  listBills: (homeId: string, signal?: AbortSignal) =>
    request<{ bills: Bill[] }>('GET', `/api/homes/${encodeURIComponent(homeId)}/bills`, { signal }),
  createBill: (homeId: string, title: string, totalCents: number) =>
    request<Bill>('POST', `/api/homes/${encodeURIComponent(homeId)}/bills`, {
      body: { title, totalCents },
    }),
  getBalances: (homeId: string, signal?: AbortSignal) =>
    request<{ balances: Balance[] }>('GET', `/api/homes/${encodeURIComponent(homeId)}/balances`, {
      signal,
    }),
  payShare: (billId: string, shareId: string, idempotencyKey: string) =>
    request<Share>(
      'POST',
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    ),
}

/** Dollars-and-cents text for display only. Money itself stays in integer cents. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** "12.34" -> 1234. Returns null for anything that is not a positive amount with at most 2 decimals. */
export function parseDollarsToCents(input: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return cents > 0 ? cents : null
}
