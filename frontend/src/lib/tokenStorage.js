// Where the session is kept.
//
// On the web this is localStorage. In the Expo apps, swap the implementation for
// expo-secure-store (the iOS Keychain and Android Keystore) and leave the rest
// of the API client untouched — nothing else reads storage directly.
//
// The access token is short-lived and stays in memory. Only the refresh token is
// persisted, so a closed tab does not mean signing in again.

const REFRESH_TOKEN_KEY = 'foodos.refreshToken'
const USER_KEY = 'foodos.user'

let accessToken = null

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = token
}

// Private browsing and blocked site data make localStorage throw, so every
// access is guarded: a failure signs the user out rather than crashing the app.
function safeRead(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeWrite(key, value) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Session lasts for this tab only.
  }
}

export function getRefreshToken() {
  return safeRead(REFRESH_TOKEN_KEY)
}

export function getStoredUser() {
  const raw = safeRead(USER_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveSession({ accessToken: access, refreshToken, user }) {
  setAccessToken(access)
  safeWrite(REFRESH_TOKEN_KEY, refreshToken)

  if (user) {
    safeWrite(USER_KEY, JSON.stringify(user))
  }
}

export function clearSession() {
  setAccessToken(null)
  safeWrite(REFRESH_TOKEN_KEY, null)
  safeWrite(USER_KEY, null)
}
