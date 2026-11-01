import { type FormEvent, useRef, useState } from 'react'
import {
  ApiError,
  api,
  type Bill,
  formatCents,
  type Member,
  parseDollarsToCents,
  type Share,
} from '../api'

type Props = {
  homeId: string
  members: Member[]
  bills: Bill[]
  onChanged: () => void
}

export function BillsPanel({ homeId, members, bills, onChanged }: Props) {
  const nameById = new Map(members.map((m) => [m.id, m.name]))
  return (
    <section>
      <h2>Bills</h2>
      <NewBillForm homeId={homeId} canCreate={members.length > 0} onCreated={onChanged} />
      {bills.length === 0 ? (
        <p className="muted">No bills yet. Add one above.</p>
      ) : (
        <ul className="list">
          {bills.map((bill) => (
            <li key={bill.id} className="card">
              <h3>
                {bill.title} <span className="muted">· {formatCents(bill.totalCents)}</span>
              </h3>
              <ul className="list">
                {bill.shares.map((share) => (
                  <ShareRow
                    key={share.id}
                    billId={bill.id}
                    share={share}
                    memberName={nameById.get(share.memberId) ?? 'Unknown member'}
                    onPaid={onChanged}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NewBillForm({
  homeId,
  canCreate,
  onCreated,
}: {
  homeId: string
  canCreate: boolean
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const cents = parseDollarsToCents(amount)
    if (cents === null) {
      setError('Enter a positive amount like 12.50')
      return
    }
    setPending(true)
    setError(null)
    try {
      await api.createBill(homeId, title, cents)
      setTitle('')
      setAmount('')
      onCreated()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  if (!canCreate) return <p className="muted">Add at least one member before creating a bill.</p>

  return (
    <form onSubmit={submit} className="row">
      <input
        aria-label="Bill title"
        placeholder="Title (e.g. Electricity)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        disabled={pending}
      />
      <input
        aria-label="Total amount in dollars"
        placeholder="Total (e.g. 10.00)"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={pending}
      />
      <button type="submit" disabled={pending || title.trim() === '' || amount.trim() === ''}>
        {pending ? 'Creating…' : 'Add bill'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  )
}

function ShareRow({
  billId,
  share,
  memberName,
  onPaid,
}: {
  billId: string
  share: Share
  memberName: string
  onPaid: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per payment attempt. It is kept after a failure, so a retry of a request
  // that may have reached the server is safe (the server treats it as the same payment).
  const keyRef = useRef<string | null>(null)

  async function pay() {
    if (pending) return
    keyRef.current ??= crypto.randomUUID()
    setPending(true)
    setError(null)
    try {
      await api.payShare(billId, share.id, keyRef.current)
      keyRef.current = null
      onPaid()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status !== null && caught.status < 500) {
        keyRef.current = null // the server definitively refused; a retry is a new attempt
        if (caught.status === 409) onPaid() // someone else paid it: refresh to show the truth
      }
      setError(caught instanceof ApiError ? caught.message : 'Payment failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="share">
      <span>
        {memberName} · {formatCents(share.amountCents)}
      </span>
      {share.paidAt ? (
        <span className="paid">Paid {new Date(share.paidAt).toLocaleDateString()}</span>
      ) : (
        <button type="button" onClick={pay} disabled={pending}>
          {pending ? 'Paying…' : error ? 'Retry payment' : 'Pay'}
        </button>
      )}
      {error && !share.paidAt && (
        <p role="alert" className="error">
          Payment failed: {error}. The share is still unpaid.
        </p>
      )}
    </li>
  )
}
