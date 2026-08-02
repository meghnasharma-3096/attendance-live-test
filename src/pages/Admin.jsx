import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

const STATUS_STYLES = {
  not_started: 'bg-gray-100 text-gray-600',
  qr_live: 'bg-green-100 text-green-700',
  ended: 'bg-blue-50 text-blue-700',
}

function statusLabel(status) {
  if (status === 'not_started') return 'Not started'
  if (status === 'qr_live') return 'Live now'
  if (status === 'ended') return 'Ended'
  return status
}

export default function Admin() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [course, setCourse] = useState(null)
  const [students, setStudents] = useState([])
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    if (!user) return

    async function loadData() {
      setLoading(true)
      setError('')

      const { data: courseRow, error: courseError } = await supabase
        .from('courses')
        .select('id, name, professor_name, total_sessions')
        .limit(1)
        .maybeSingle()

      if (courseError || !courseRow) {
        setError(courseError?.message ?? 'No course found')
        setLoading(false)
        return
      }

      const [studentsRes, sessionsRes] = await Promise.all([
        supabase.from('students').select('pgp_id, name').order('name'),
        supabase
          .from('sessions')
          .select('session_number, session_date, status')
          .eq('course_id', courseRow.id)
          .order('session_number'),
      ])

      if (studentsRes.error) {
        setError(studentsRes.error.message)
        setLoading(false)
        return
      }
      if (sessionsRes.error) {
        setError(sessionsRes.error.message)
        setLoading(false)
        return
      }

      setCourse(courseRow)
      setStudents(studentsRes.data ?? [])
      setSessions(sessionsRes.data ?? [])
      setLoading(false)
    }

    loadData()
  }, [user])

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
        <p className="text-sm font-medium text-maroon-600">Admin Dashboard</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">{course.name}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {course.professor_name} · {students.length} students · {course.total_sessions} sessions
          planned
        </p>
      </Card>

      <div className="mt-6 rounded-xl bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Course Roster ({students.length})
          </h2>
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">PGP ID</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student, i) => (
                <tr key={student.pgp_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-3 font-medium text-gray-900">{student.name}</td>
                  <td className="px-6 py-3 text-gray-600">{student.pgp_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Sessions ({sessions.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                <th className="px-6 py-3">Session #</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session, i) => (
                <tr
                  key={session.session_number}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-6 py-3 font-medium text-gray-900">
                    {session.session_number}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{session.session_date}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        STATUS_STYLES[session.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {statusLabel(session.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-10">{children}</div>
}
