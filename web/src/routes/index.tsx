import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api, formatCents } from '../api'
import { BillsPanel } from '../components/BillsPanel'
import { TextForm } from '../components/Forms'
import { useLoad } from '../useLoad'
import '../styles.css'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { home?: string } =>
    typeof search.home === 'string' && search.home !== '' ? { home: search.home } : {},
  component: Page,
})

function Page() {
  const { home } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <main>
      <h1>Bill Splitter</h1>
      {home ? (
        <HomeView homeId={home} onLeave={() => navigate({ search: {} })} />
      ) : (
        <section>
          <h2>Create a home</h2>
          <TextForm
            label="Home name"
            placeholder="Home name (e.g. Flat 4B)"
            submitLabel="Create home"
            onSubmit={async (name) => {
              const created = await api.createHome(name)
              await navigate({ search: { home: created.id } })
            }}
          />
        </section>
      )}
    </main>
  )
}

function HomeView({ homeId, onLeave }: { homeId: string; onLeave: () => void }) {
  const home = useLoad(`home:${homeId}`, (signal) => api.getHome(homeId, signal))
  const bills = useLoad(`bills:${homeId}`, (signal) => api.listBills(homeId, signal))
  const balances = useLoad(`balances:${homeId}`, (signal) => api.getBalances(homeId, signal))

  const refreshAll = () => {
    home.reload()
    bills.reload()
    balances.reload()
  }

  if (home.state.status === 'loading') return <p aria-busy="true">Loading home…</p>
  if (home.state.status === 'error') {
    return (
      <div role="alert" className="error-box">
        <p>Could not load this home: {home.state.message}</p>
        <button type="button" onClick={home.reload}>
          Try again
        </button>{' '}
        <button type="button" onClick={onLeave}>
          Back
        </button>
      </div>
    )
  }

  const { name, members } = home.state.data

  return (
    <>
      <p>
        <button type="button" onClick={onLeave}>
          ← Other home
        </button>
      </p>
      <h2>{name}</h2>

      <section>
        <h3>Members</h3>
        {members.length === 0 ? (
          <p className="muted">No members yet.</p>
        ) : (
          <ul className="list">
            {members.map((m) => (
              <li key={m.id}>{m.name}</li>
            ))}
          </ul>
        )}
        <TextForm
          label="Member name"
          placeholder="Member name"
          submitLabel="Add member"
          onSubmit={async (memberName) => {
            await api.addMember(homeId, memberName)
            refreshAll()
          }}
        />
      </section>

      <section>
        <h3>Who owes what</h3>
        {balances.state.status === 'loading' && <p aria-busy="true">Loading balances…</p>}
        {balances.state.status === 'error' && (
          <div role="alert" className="error-box">
            Could not load balances: {balances.state.message}{' '}
            <button type="button" onClick={balances.reload}>
              Retry
            </button>
          </div>
        )}
        {balances.state.status === 'ready' &&
          (balances.state.data.balances.length === 0 ? (
            <p className="muted">Nobody to show yet.</p>
          ) : (
            <ul className="list">
              {balances.state.data.balances.map((b) => (
                <li key={b.memberId}>
                  {b.name}: {formatCents(b.outstandingCents)}
                </li>
              ))}
            </ul>
          ))}
      </section>

      {bills.state.status === 'loading' && <p aria-busy="true">Loading bills…</p>}
      {bills.state.status === 'error' && (
        <div role="alert" className="error-box">
          Could not load bills: {bills.state.message}{' '}
          <button type="button" onClick={bills.reload}>
            Retry
          </button>
        </div>
      )}
      {bills.state.status === 'ready' && (
        <BillsPanel
          homeId={homeId}
          members={members}
          bills={bills.state.data.bills}
          onChanged={refreshAll}
        />
      )}
    </>
  )
}
