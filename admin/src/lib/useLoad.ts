import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

type State<T> = {
  data: T | null
  error: ApiError | null
  loading: boolean
  // Re-fetches without blanking what is on screen.
  reload: () => Promise<void>
  setData: (data: T) => void
}

// Loads data for a screen and keeps it fresh.
//
// `key` changes when the inputs change (filters, page); the previous response
// stays on screen until the new one arrives, and a slow old response can never
// overwrite a newer one. `refreshMs` polls while the tab is visible.
export function useLoad<T>(load: () => Promise<T>, key: string, refreshMs?: number): State<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)
  const loader = useRef(load)
  loader.current = load

  const run = useCallback(async () => {
    const ticket = ++latest.current
    setLoading(true)

    try {
      const result = await loader.current()
      if (ticket !== latest.current) return
      setData(result)
      setError(null)
    } catch (caught) {
      if (ticket !== latest.current) return
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'unknown', 'Something went wrong'))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    run()
  }, [key, run])

  useEffect(() => {
    if (!refreshMs) return

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, refreshMs)

    return () => window.clearInterval(timer)
  }, [refreshMs, run])

  return { data, error, loading, reload: run, setData }
}
