import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div>
      <h1>404 - Page not found</h1>
      <Link to="/login">Back to login</Link>
    </div>
  )
}
