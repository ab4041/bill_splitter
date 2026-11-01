import { type FormEvent, useState } from 'react'
import { ApiError } from '../api'

type TextFormProps = {
  label: string
  placeholder: string
  submitLabel: string
  onSubmit: (value: string) => Promise<void>
}

/** One text field + button. Shows its own pending and error state; never throws. */
export function TextForm({ label, placeholder, submitLabel, onSubmit }: TextFormProps) {
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handle(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onSubmit(value)
      setValue('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handle} className="row">
      <label>
        <span className="sr-only">{label}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          maxLength={200}
          disabled={pending}
        />
      </label>
      <button type="submit" disabled={pending || value.trim() === ''}>
        {pending ? 'Working…' : submitLabel}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  )
}
