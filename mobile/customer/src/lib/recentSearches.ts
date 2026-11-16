import * as SecureStore from 'expo-secure-store'

// The last few searches, shown as suggestions when the search box is empty.
// Kept on the phone only; losing them is harmless, so every failure is ignored.

const KEY = 'foodos.recentSearches'
const KEEP = 6

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const saved = await SecureStore.getItemAsync(KEY)

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
    await SecureStore.setItemAsync(KEY, JSON.stringify(next))
  } catch {
    // Not saved this time; the search itself still works.
  }

  return next
}
