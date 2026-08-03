import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Student from './pages/Student.jsx'
import CourseDetail from './pages/CourseDetail.jsx'
import Professor from './pages/Professor.jsx'
import ProfessorLive from './pages/ProfessorLive.jsx'
import Admin from './pages/Admin.jsx'
import Scan from './pages/Scan.jsx'
import Anomalies from './pages/Anomalies.jsx'
import NotFound from './pages/NotFound.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/student"
        element={
          <ProtectedRoute role="student">
            <Student />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/course/:courseId"
        element={
          <ProtectedRoute role="student">
            <CourseDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/professor"
        element={
          <ProtectedRoute role="professor">
            <Professor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/professor/live/:sessionId"
        element={
          <ProtectedRoute role="professor">
            <ProfessorLive />
          </ProtectedRoute>
        }
      />
      <Route
        path="/professor/anomalies"
        element={
          <ProtectedRoute role="professor">
            <Anomalies />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute role="admin">
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scan"
        element={
          <ProtectedRoute role="student">
            <Scan />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
