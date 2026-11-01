import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { splitCents } from './split'

type AppEnv = { Bindings: Env }

type HomeRow = { id: string; name: string }
type MemberRow = { id: string; home_id: string; name: string }
type BillRow = { id: string; home_id: string; title: string; total_cents: number }
type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  payment_key: string | null
}

const MAX_NAME_LENGTH = 200
const MAX_KEY_LENGTH = 255

const app = new Hono<AppEnv>()

// ---------- helpers ----------

function fail(status: 400 | 404 | 409 | 422, message: string): never {
  throw new HTTPException(status, { message })
}

/** Reads the JSON body as an object. Anything else is a 400, never a crash. */
async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    fail(400, 'Request body must be valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(400, 'Request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(422, `${field} must be a non-empty string`)
  }
  const trimmed = value.trim()
  if (trimmed.length > MAX_NAME_LENGTH) {
    fail(422, `${field} must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return trimmed
}

function toShare(row: ShareRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
  }
}

async function findHome(db: D1Database, homeId: string): Promise<HomeRow> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) fail(404, 'Home not found')
  return home
}

// ---------- routes ----------

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Part 1: homes and members

app.post('/api/homes', async (c) => {
  const body = await readJsonObject(c.req.raw)
  const name = requireText(body.name, 'name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const home = await findHome(c.env.DB, c.req.param('homeId'))
  const { results } = await c.env.DB.prepare(
    'SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY seq',
  )
    .bind(home.id)
    .all<MemberRow>()
  return c.json({
    id: home.id,
    name: home.name,
    members: results.map((m) => ({ id: m.id, homeId: m.home_id, name: m.name })),
  })
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  await findHome(c.env.DB, homeId)
  const body = await readJsonObject(c.req.raw)
  const name = requireText(body.name, 'name')
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
      .bind(id, homeId, name)
      .run()
  } catch (error) {
    // The home can be deleted between the check above and this insert; the
    // foreign key then rejects the row instead of leaving an orphan member.
    if (error instanceof Error && /FOREIGN KEY/i.test(error.message)) fail(404, 'Home not found')
    throw error
  }
  return c.json({ id, homeId, name }, 201)
})

// Part 2: bills, payments, balances

app.post('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await findHome(db, homeId)

  const body = await readJsonObject(c.req.raw)
  const title = requireText(body.title, 'title')
  const totalCents = body.totalCents
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    fail(422, 'totalCents must be a positive whole number')
  }

  const { results: members } = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY seq')
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) fail(422, 'Home has no members')

  const amounts = splitCents(totalCents, members.length)
  const billId = crypto.randomUUID()
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
    paidAt: null,
  }))

  // db.batch runs as one transaction: the bill and all its shares exist, or none do.
  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      db
        .prepare('INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const home = await findHome(db, c.req.param('homeId'))
  const [billsResult, sharesResult] = await db.batch([
    db
      .prepare(
        'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY seq DESC',
      )
      .bind(home.id),
    db
      .prepare(
        `SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, s.payment_key
         FROM shares s JOIN bills b ON b.id = s.bill_id
         WHERE b.home_id = ? ORDER BY s.seq`,
      )
      .bind(home.id),
  ])
  const bills = (billsResult?.results ?? []) as BillRow[]
  const shares = (sharesResult?.results ?? []) as ShareRow[]
  return c.json({
    bills: bills.map((bill) => ({
      id: bill.id,
      homeId: bill.home_id,
      title: bill.title,
      totalCents: bill.total_cents,
      shares: shares.filter((s) => s.bill_id === bill.id).map(toShare),
    })),
  })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const db = c.env.DB
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) fail(400, 'Idempotency-Key header is required')
  if (key.length > MAX_KEY_LENGTH) fail(400, 'Idempotency-Key is too long')

  // One atomic statement: only the request that finds the share still unpaid
  // can update it. Concurrent requests cannot both pass the `paid_at IS NULL` test.
  const paidNow = await db
    .prepare(
      `UPDATE shares
       SET paid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), payment_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL
       RETURNING id, bill_id, member_id, amount_cents, paid_at, payment_key`,
    )
    .bind(key, shareId, billId)
    .first<ShareRow>()
  if (paidNow) return c.json(toShare(paidNow))

  // Nothing was updated: the share is missing, or already paid.
  const existing = await db
    .prepare(
      `SELECT id, bill_id, member_id, amount_cents, paid_at, payment_key
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (!existing) fail(404, 'Bill or share not found')
  if (existing.payment_key === key) return c.json(toShare(existing)) // replay of the same request
  fail(409, 'Share was already paid with a different Idempotency-Key')
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const db = c.env.DB
  const home = await findHome(db, c.req.param('homeId'))
  const { results } = await db
    .prepare(
      `SELECT m.id AS member_id, m.name AS name, COALESCE(SUM(s.amount_cents), 0) AS outstanding
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
       WHERE m.home_id = ?
       GROUP BY m.id, m.seq
       ORDER BY m.seq`,
    )
    .bind(home.id)
    .all<{ member_id: string; name: string; outstanding: number }>()
  return c.json({
    balances: results.map((r) => ({
      memberId: r.member_id,
      name: r.name,
      outstandingCents: r.outstanding,
    })),
  })
})

// ---------- errors: always JSON { error } ----------

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }
  console.error('Unhandled error', error)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
