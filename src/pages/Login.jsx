import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { ROLE_ROUTES } from '../lib/roleRoutes.js'

export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: rpcError } = await supabase.rpc('verify_login', {
      p_identifier: identifier,
      p_password: password,
    })

    setLoading(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    if (!data || data.length === 0) {
      setError('Invalid email/ID or password')
      return
    }

    const user = data[0]
    login(user)

    const route = ROLE_ROUTES[user.role]
    if (!route) {
      setError(`Unknown role: ${user.role}`)
      return
    }
    navigate(route, { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md sm:p-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-maroon-600" />
          <h1 className="text-2xl font-bold text-gray-900">Attendance System</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="identifier"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Email / ID
            </label>
            <input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-maroon-600 px-4 py-2.5 font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
