// The last few searches, on the website: kept in this browser only. Private
// windows and blocked site data make storage throw, which just means no history.

const KEY = 'foodos.recentSearches'
const KEEP = 6

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const saved = window.localStorage.getItem(KEY)

    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

export async function rememberSearch(term: string): Promise<string[]> {
  const cleaned = term.trim()
  const previous = await loadRecentSearches()

  if (!cleaned) return previous

  const next = [cleaned, ...previous.filter(item => item.toLowerCase() !== cleaned.toLowerCase())].slice(0, KEEP)

  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Not saved this time; the search itself still works.
  }

  return next
}
