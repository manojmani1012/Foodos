import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, clearSession, hasStoredSession, refreshSession, setSession, whenSignedOut } from './api'

export type Admin = {
  id: string
  email: string
  fullName: string | null
  role: 'admin' | 'super_admin'
}

type AuthState = {
  admin: Admin | null
  // True until a stored session has been checked on first load.
  restoring: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const REFRESH_KEY = 'foodos.admin.refresh'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [restoring, setRestoring] = useState(hasStoredSession())

  useEffect(() => {
    whenSignedOut(() => setAdmin(null))

    if (!hasStoredSession()) return

    // A reload: trade the stored refresh token for a fresh access token, then
    // find out who it belongs to.
    ;(async () => {
      try {
        if (await refreshSession()) {
          const { user } = await api<{ user: any }>('/api/v1/auth/me')

          if (user.role === 'admin' || user.role === 'super_admin') {
            setAdmin({ id: user.id, email: user.email, fullName: user.fullName, role: user.role })
          } else {
            clearSession()
          }
        }
      } catch {
        // Left signed out; the login screen explains any connection problem.
      } finally {
        setRestoring(false)
      }
    })()
  }, [])

  // Signing out in one tab signs out the others.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === REFRESH_KEY && !event.newValue) setAdmin(null)
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const body = await api<any>('/api/v1/auth/admin/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })

    setSession({ accessToken: body.accessToken, refreshToken: body.refreshToken })
    setAdmin({ id: body.user.id, email: body.user.email, fullName: body.user.fullName, role: body.user.role })
  }, [])

  const signOut = useCallback(async () => {
    let token: string | null = null
    try {
      token = localStorage.getItem(REFRESH_KEY)
    } catch {
      token = null
    }

    clearSession()
    setAdmin(null)

    if (token) {
      // Best effort: the session is already gone from this browser.
      api('/api/v1/auth/logout', { method: 'POST', body: { refreshToken: token }, auth: false }).catch(() => {})
    }
  }, [])

  const value = useMemo(() => ({ admin, restoring, signIn, signOut }), [admin, restoring, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
