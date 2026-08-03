import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import SignOutButton from '../components/SignOutButton.jsx'

export default function Student() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [studentName, setStudentName] = useState('')
  const [courses, setCourses] = useState([])

  useEffect(() => {
    if (!user?.student_pgp_id) return

    async function loadCourses() {
      setLoading(true)
      setError('')

      const [studentRes, enrollmentsRes] = await Promise.all([
        supabase.from('students').select('name').eq('pgp_id', user.student_pgp_id).single(),
        supabase
          .from('enrollments')
          .select('courses(id, name, professor_name)')
          .eq('student_pgp_id', user.student_pgp_id),
      ])

      if (studentRes.error) {
        setError(studentRes.error.message)
        setLoading(false)
        return
      }
      if (enrollmentsRes.error) {
        setError(enrollmentsRes.error.message)
        setLoading(false)
        return
      }

      setStudentName(studentRes.data.name)
      setCourses((enrollmentsRes.data ?? []).map((e) => e.courses).filter(Boolean))
      setLoading(false)
    }

    loadCourses()
  }, [user?.student_pgp_id])

  if (loading) {
    return (
      <PageShell>
        <Card>
          <p className="text-gray-500">Loading…</p>
        </Card>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell>
        <Card>
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-maroon-600">Student Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">{studentName}</h1>
            <p className="mt-2 text-sm text-gray-500">Your enrolled courses</p>
          </div>
          <SignOutButton />
        </div>
      </Card>

      <div className="mt-6 space-y-3">
        {courses.map((course) => (
          <Link
            key={course.id}
            to={`/student/course/${course.id}`}
            className="block rounded-xl bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 className="text-lg font-semibold text-gray-900">{course.name}</h2>
            <p className="mt-1 text-sm text-gray-500">{course.professor_name}</p>
          </Link>
        ))}
        {courses.length === 0 && (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-gray-500">You're not enrolled in any courses yet.</p>
          </div>
        )}
      </div>
    </PageShell>
  )
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  )
}

function Card({ children }) {
  return <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">{children}</div>
}
