import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function SignOutButton() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="shrink-0 text-sm font-medium text-gray-500 hover:text-gray-700"
    >
      Sign Out
    </button>
  )
}
