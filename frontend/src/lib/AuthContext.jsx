import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, saveSession } from './apiClient.js'
import { clearSession, getRefreshToken, getStoredUser } from './tokenStorage.js'

const AuthContext = createContext(null)

// `role` is which app this is: 'customer', 'restaurant_owner' or
// 'delivery_partner'. The session is scoped to it, so a rider who also orders
// food gets a customer session in the customer app and nothing more.
export function AuthProvider({ role, children }) {
  const [user, setUser] = useState(() => getStoredUser())
  const [status, setStatus] = useState('loading') // 'loading' | 'signed-in' | 'signed-out'

  // On load the access token is gone (it lives in memory), but the refresh
  // token may still be good, so try to restore the session before showing login.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!getRefreshToken()) {
        if (!cancelled) setStatus('signed-out')
        return
      }

      try {
        const { user: current } = await api.me()

        if (!cancelled) {
          setUser(current)
          setStatus('signed-in')
        }
      } catch {
        clearSession()

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

  const requestOtp = useCallback(phone => api.requestOtp(phone), [])

  const verifyOtp = useCallback(
    async (phone, code) => {
      const result = await api.verifyOtp({ phone, code, role })

      saveSession({
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
    () => ({ user, status, isSignedIn: status === 'signed-in', requestOtp, verifyOtp, signOut }),
    [user, status, requestOtp, verifyOtp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }

  return context
}
