import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

const STORAGE_KEY = 'user'

// This app uses a custom verify_login RPC instead of Supabase Auth, so there's no real
// token or server-side expiry — login state is just this localStorage blob, checked on
// load. localStorage (not sessionStorage) is deliberate: a student's phone can get its
// browser tab killed and "restored" mid-class (backgrounding, OS memory pressure), which
// can behave like a fresh load rather than a same-tab reload, and sessionStorage doesn't
// reliably survive that. logged_in_at is a soft, client-only expiry — 12 hours comfortably
// covers a full day of class use without ever forcing a re-login mid-session.
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000

function readStoredUser() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }

  const { logged_in_at, ...userData } = parsed
  if (!logged_in_at || Date.now() - logged_in_at > SESSION_MAX_AGE_MS) {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }

  return userData
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser)

  function login(userData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...userData, logged_in_at: Date.now() }))
    setUser(userData)
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
