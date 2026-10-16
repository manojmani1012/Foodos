// Where the session is kept, on the website.
//
// The phone version uses the iOS Keychain or Android Keystore. A browser has
// neither, so the refresh token sits in localStorage, which only this site can
// read; the site's Content-Security-Policy stops injected scripts from running
// to read it. The access token is short-lived and stays in memory.

const REFRESH_TOKEN_KEY = 'foodos.refreshToken'
const USER_KEY = 'foodos.user'

export type StoredUser = {
  id: string
  phone?: string | null
  fullName?: string | null
  role?: string
  roles?: string[]
}

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

// Private windows and blocked site data make storage throw; that means "no
// saved session" rather than a crash.
function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeWrite(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // The session lasts until the tab is closed.
  }
}

export async function getRefreshToken(): Promise<string | null> {
  return safeRead(REFRESH_TOKEN_KEY)
}

export async function getStoredUser(): Promise<StoredUser | null> {
  const raw = safeRead(USER_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredUser
  } catch {
    return null
  }
}

export async function saveSession({
  accessToken: access,
  refreshToken,
  user,
}: {
  accessToken: string
  refreshToken: string
  user?: StoredUser
}): Promise<void> {
  setAccessToken(access)
  safeWrite(REFRESH_TOKEN_KEY, refreshToken)

  if (user) {
    safeWrite(USER_KEY, JSON.stringify(user))
  }
}

export async function clearSession(): Promise<void> {
  setAccessToken(null)
  safeWrite(REFRESH_TOKEN_KEY, null)
  safeWrite(USER_KEY, null)
}
