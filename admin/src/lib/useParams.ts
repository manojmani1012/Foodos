import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// Filters live in the address bar, so a filtered list can be bookmarked,
// shared with a colleague, or come back to with the browser's Back button.
export function useFilters<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams()

  const values = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback])
  ) as T

  const set = useCallback(
    (changes: Partial<T>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)

          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === '' || value === defaults[key]) next.delete(key)
            else next.set(key, String(value))
          }

          // Any filter change starts again from the first page.
          if (!('offset' in changes)) next.delete('offset')

          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  return [values, set] as const
}
