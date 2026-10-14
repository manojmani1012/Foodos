// The one way the panel talks to the API.
//
// The access token lives in memory only. The refresh token is kept in
// localStorage so a reload or a new tab stays signed in; it is useless without
// this origin, and the CSP on the deployed site blocks injected scripts.

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '')
const REFRESH_KEY = 'foodos.admin.refresh'

export class ApiError extends Error {
  status: number
  code: string
  fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

type Session = { accessToken: string; refreshToken: string }

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null
let onSignedOut: (() => void) | null = null

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

function writeRefreshToken(token: string | null) {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token)
    else localStorage.removeItem(REFRESH_KEY)
  } catch {
    // Private windows can refuse storage; the session then lasts until reload.
  }
}

export function setSession(session: Session) {
  accessToken = session.accessToken
  writeRefreshToken(session.refreshToken)
}

export function clearSession() {
  accessToken = null
  writeRefreshToken(null)
}

export function hasStoredSession() {
  return !!readRefreshToken()
}

export function whenSignedOut(callback: () => void) {
  onSignedOut = callback
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return /^https?:\/\//.test(path) ? path : `${BASE_URL}${path}`
}

// Every request that finds its token expired waits on the same refresh, and
// tabs take turns through a browser lock, so the token is never rotated twice
// at once (the API treats a reused refresh token as theft and ends the session).
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing

  if (!readRefreshToken()) return Promise.resolve(false)

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined

  refreshing = (locks ? locks.request('foodos-admin-refresh', rotate) : rotate()).finally(() => {
    refreshing = null
  })

  return refreshing
}

async function rotate(): Promise<boolean> {
  // Read inside the lock: another tab may have rotated it a moment ago.
  const token = readRefreshToken()
  if (!token) return false

  try {
    const response = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    })

    if (!response.ok) {
      clearSession()
      return false
    }

    const body = await response.json()
    setSession({ accessToken: body.accessToken, refreshToken: body.refreshToken })
    return true
  } catch {
    // Offline or the API is waking up: keep the stored token and let the
    // caller show a connection error rather than signing out.
    return false
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Query
  auth?: boolean
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(`${BASE_URL}${path}`)

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  return url.toString()
}

async function send(path: string, options: Options): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the Foodos server. Check your connection and try again')
  }
}

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  let response = await send(path, options)

  if (response.status === 401 && options.auth !== false) {
    const renewed = await refreshSession()

    if (renewed) {
      response = await send(path, options)
    } else if (!hasStoredSession()) {
      onSignedOut?.()
    }
  }

  let body: any = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const fields: Record<string, string> = body?.details?.fields || {}
    const firstField = Object.values(fields)[0]
    // Pydantic's own wording starts "Value error, ..."; the message after it is ours.
    const message =
      body?.code === 'validation_failed' && firstField
        ? String(firstField).replace(/^Value error, /, '')
        : body?.message || `Request failed (${response.status})`

    throw new ApiError(response.status, body?.code || 'request_failed', message, fields)
  }

  return body as T
}
