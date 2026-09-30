import { useCallback, useEffect, useRef, useState } from 'react'

// Runs an async function and reports loading, data and error.
//
// Results that arrive after the inputs changed, or after the screen closed, are
// discarded — otherwise a slow first request can overwrite a newer one, which is
// exactly what happens when someone types quickly into the search box.
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const runId = useRef(0)

  const run = useCallback(() => {
    const id = ++runId.current

    setState(previous => ({ ...previous, loading: true, error: null }))

    Promise.resolve()
      .then(loader)
      .then(data => {
        if (id === runId.current) {
          setState({ loading: false, data, error: null })
        }
      })
      .catch(error => {
        if (id === runId.current) {
          setState({ loading: false, data: null, error })
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()

    return () => {
      // Abandon whatever is in flight when the screen unmounts.
      runId.current += 1
    }
  }, [run])

  return { ...state, reload: run }
}

// Waits for typing to settle before firing a search.
export function useDebounced(value, delay = 350) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)

    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}
