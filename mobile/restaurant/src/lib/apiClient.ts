import Constants from 'expo-constants'
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveSession,
  setAccessToken,
} from './tokenStorage'

// Where the API lives.
//
// In development the phone has to reach this computer over Wi-Fi, and its
// address changes whenever the router reassigns it. Expo already knows that
// address — it is the host serving the bundle — so the API host is taken from
// there and nothing needs configuring by hand.
//
// Set EXPO_PUBLIC_API_URL to point somewhere else (a staging server, say).
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL

  if (configured) {
    return configured.replace(/\/+$/, '')
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost

  const host = hostUri?.split(':')[0]

  if (host) {
    return `http://${host}:4000`
  }

  // A production build with no configured URL: fail loudly rather than
  // silently talking to localhost, which on a phone means the phone itself.
  return 'http://localhost:4000'
}

export const API_BASE_URL = resolveBaseUrl()

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, body: { message?: string; code?: string; details?: unknown } | null) {
    super(body?.message || 'Something went wrong. Please try again')
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code || 'unknown_error'
    this.details = body?.details
  }
}

async function parseBody(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

// The one refresh in flight, shared by every caller.
//
// The API rotates refresh tokens and treats a replayed one as theft: it revokes
// the whole session. A home screen fires several requests at once, so without
// this they would each refresh on their own, three would present an
// already-rotated token, and the user would be signed out at random.
let refreshInFlight: Promise<string> | null = null

async function performRefresh(): Promise<string> {
  const refreshToken = await getRefreshToken()

  if (!refreshToken) {
    throw new ApiError(401, { code: 'token_missing', message: 'Sign in to continue' })
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })

  const body = await parseBody(response)

  if (!response.ok) {
    await clearSession()
    throw new ApiError(response.status, body)
  }

  await saveSession({ accessToken: body.accessToken, refreshToken: body.refreshToken })

  return body.accessToken as string
}

function refreshOnce(): Promise<string> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

type RequestOptions = {
  method?: string
  body?: unknown
  auth?: boolean
  accessToken?: string | null
  retryOnExpiry?: boolean
}

async function send(path: string, options: RequestOptions = {}) {
  const { method = 'GET', body, auth = true, accessToken } = options
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const token = accessToken ?? (auth ? getAccessToken() : null)

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const parsed = await parseBody(response)

  if (!response.ok) {
    throw new ApiError(response.status, parsed)
  }

  return parsed
}

export async function request(path: string, options: RequestOptions = {}) {
  const { auth = true, retryOnExpiry = true } = options

  try {
    return await send(path, options)
  } catch (error) {
    const expired =
      error instanceof ApiError && error.status === 401 && error.code === 'token_expired'

    if (!expired || !auth || !retryOnExpiry) {
      throw error
    }

    // One retry with a fresh token; a second failure is a real sign-out.
    const freshToken = await refreshOnce()

    return send(path, { ...options, accessToken: freshToken })
  }
}

export const api = {
  requestOtp: (phone: string) =>
    request('/api/v1/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),

  verifyOtp: ({ phone, code, role }: { phone: string; code: string; role: string }) =>
    request('/api/v1/auth/otp/verify', { method: 'POST', body: { phone, code, role }, auth: false }),

  me: () => request('/api/v1/auth/me'),

  logout: async () => {
    const refreshToken = await getRefreshToken()

    if (refreshToken) {
      // A failed logout must not trap the user in a signed-in state.
      await request('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      }).catch(() => {})
    }

    await clearSession()
  },
}

export { clearSession, saveSession, setAccessToken }
