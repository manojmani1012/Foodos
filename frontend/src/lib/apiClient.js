import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveSession,
  setAccessToken,
} from './tokenStorage.js'

// Default to the host the page was served from, so opening the app at
// http://192.168.1.13:5173 on a phone reaches the API on the same machine
// without any configuration. Override with VITE_API_BASE_URL when the API
// lives somewhere else.
function defaultBaseUrl() {
  const configured = import.meta.env?.VITE_API_BASE_URL

  if (configured) {
    return configured.replace(/\/+$/, '')
  }

  const { protocol, hostname } = window.location

  return `${protocol}//${hostname}:4000`
}

export const API_BASE_URL = defaultBaseUrl()

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || 'Something went wrong. Please try again')
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code || 'unknown_error'
    this.details = body?.details
  }
}

async function parseBody(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

// The one refresh in flight, shared by every caller.
//
// This matters because the API rotates refresh tokens and treats a replayed one
// as a theft: it revokes the whole session. If four requests all got a 401 and
// each refreshed on its own, three would present an already-rotated token and
// the user would be signed out. So they all await the same promise.
let refreshInFlight = null

async function performRefresh() {
  const refreshToken = getRefreshToken()

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
    clearSession()
    throw new ApiError(response.status, body)
  }

  saveSession({ accessToken: body.accessToken, refreshToken: body.refreshToken })

  return body.accessToken
}

function refreshOnce() {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

async function send(path, { method = 'GET', body, auth = true, accessToken } = {}) {
  const headers = { Accept: 'application/json' }

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

export async function request(path, options = {}) {
  const { auth = true, retryOnExpiry = true } = options

  try {
    return await send(path, options)
  } catch (error) {
    const expired = error instanceof ApiError && error.status === 401 && error.code === 'token_expired'

    if (!expired || !auth || !retryOnExpiry) {
      throw error
    }

    // One retry with a fresh token; a second failure is a real sign-out.
    const freshToken = await refreshOnce()

    return send(path, { ...options, accessToken: freshToken })
  }
}

export const api = {
  requestOtp: phone => request('/api/v1/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),

  verifyOtp: ({ phone, code, role }) =>
    request('/api/v1/auth/otp/verify', { method: 'POST', body: { phone, code, role }, auth: false }),

  adminLogin: ({ email, password }) =>
    request('/api/v1/auth/admin/login', { method: 'POST', body: { email, password }, auth: false }),

  me: () => request('/api/v1/auth/me'),

  logout: async () => {
    const refreshToken = getRefreshToken()

    if (refreshToken) {
      // A failed logout must not trap the user in a signed-in state.
      await request('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      }).catch(() => {})
    }

    clearSession()
  },
}

export { clearSession, saveSession, setAccessToken }
