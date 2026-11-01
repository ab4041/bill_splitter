import { useCallback, useEffect, useState } from 'react'
import { ApiError } from './api'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

/** Loads data on mount / when `key` changes, cancels stale requests, and exposes reload(). */
export function useLoad<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
): { state: LoadState<T>; reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `attempt` are the intended triggers
  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof ApiError ? error.message : 'Something went wrong'
        setState({ status: 'error', message })
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, reload }
}
