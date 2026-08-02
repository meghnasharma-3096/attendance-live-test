import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

function readStoredUser() {
  const raw = sessionStorage.getItem('user')
  return raw ? JSON.parse(raw) : null
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser)

  function login(userData) {
    sessionStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
  }

  function logout() {
    sessionStorage.removeItem('user')
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
