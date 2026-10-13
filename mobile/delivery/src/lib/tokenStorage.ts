import * as SecureStore from 'expo-secure-store'

// Where the session is kept.
//
// This is the one file that differs from the web version. On the web the
// refresh token sits in localStorage; here it goes to the iOS Keychain and the
// Android Keystore, which are encrypted and not readable by other apps or by a
// file browser on a rooted device.
//
// The access token is short-lived and stays in memory, so it never touches disk.

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

// SecureStore throws if the keychain is unavailable (a locked device at boot,
// or a simulator quirk). A failure means "no session" rather than a crash.
async function safeRead(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

async function safeWrite(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) {
      await SecureStore.deleteItemAsync(key)
    } else {
      await SecureStore.setItemAsync(key, value)
    }
  } catch {
    // The session lasts until the app is closed.
  }
}

export function getRefreshToken(): Promise<string | null> {
  return safeRead(REFRESH_TOKEN_KEY)
}

export async function getStoredUser(): Promise<StoredUser | null> {
  const raw = await safeRead(USER_KEY)

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
  await safeWrite(REFRESH_TOKEN_KEY, refreshToken)

  if (user) {
    await safeWrite(USER_KEY, JSON.stringify(user))
  }
}

export async function clearSession(): Promise<void> {
  setAccessToken(null)
  await safeWrite(REFRESH_TOKEN_KEY, null)
  await safeWrite(USER_KEY, null)
}
