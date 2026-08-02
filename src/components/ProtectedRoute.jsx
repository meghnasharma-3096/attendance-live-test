import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { ROLE_ROUTES } from '../lib/roleRoutes.js'

export default function ProtectedRoute({ role, children }) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.role !== role) {
    return <Navigate to={ROLE_ROUTES[user.role] ?? '/login'} replace />
  }

  return children
}
