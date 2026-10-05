import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, saveSession } from './apiClient'
import { clearSession, getRefreshToken, getStoredUser, type StoredUser } from './tokenStorage'

type AuthValue = {
  user: StoredUser | null
  status: 'loading' | 'signed-in' | 'signed-out'
  isSignedIn: boolean
  requestOtp: (phone: string) => Promise<any>
  verifyOtp: (phone: string, code: string) => Promise<any>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

// `role` is which app this is. The session is scoped to it, so a rider who also
// orders food gets a customer session here and nothing more.
export function AuthProvider({ role, children }: { role: string; children: React.ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null)
  const [status, setStatus] = useState<AuthValue['status']>('loading')

  // On launch the access token is gone — it only ever lived in memory — but the
  // refresh token survives in the keychain, so a returning user is restored
  // before the login screen would otherwise flash.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      const stored = await getStoredUser()

      if (!cancelled && stored) {
        setUser(stored)
      }

      if (!(await getRefreshToken())) {
        if (!cancelled) setStatus('signed-out')
        return
      }

      try {
        // Bounded: on a dead or unreachable network this would otherwise hang,
        // and the splash screen waits on it. Better to start signed-out than to
        // sit on the logo for ever.
        const { user: current } = await Promise.race([
          api.me(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('restore timed out')), 8000),
          ),
        ])

        if (!cancelled) {
          setUser(current)
          setStatus('signed-in')
        }
      } catch {
        await clearSession()

        if (!cancelled) {
          setUser(null)
          setStatus('signed-out')
        }
      }
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [])

  const requestOtp = useCallback((phone: string) => api.requestOtp(phone), [])

  const verifyOtp = useCallback(
    async (phone: string, code: string) => {
      const result = await api.verifyOtp({ phone, code, role })

      await saveSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      })

      setUser(result.user)
      setStatus('signed-in')

      return result
    },
    [role],
  )

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(null)
    setStatus('signed-out')
  }, [])

  const value = useMemo(
    () => ({
      user,
      status,
      isSignedIn: status === 'signed-in',
      requestOtp,
      verifyOtp,
      signOut,
    }),
    [user, status, requestOtp, verifyOtp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }

  return context
}
