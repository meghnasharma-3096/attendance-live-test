import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

export default function Student() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [studentName, setStudentName] = useState('')
  const [totalSessions, setTotalSessions] = useState(0)
  const [sessionRows, setSessionRows] = useState([])

  useEffect(() => {
    if (!user?.student_pgp_id) return

    async function loadDashboard() {
      setLoading(true)
      setError('')

      const [studentRes, courseRes] = await Promise.all([
        supabase
          .from('students')
          .select('name')
          .eq('pgp_id', user.student_pgp_id)
          .single(),
        supabase.from('courses').select('id, total_sessions').limit(1).maybeSingle(),
      ])

      if (studentRes.error) {
        setError(studentRes.error.message)
        setLoading(false)
        return
      }
      if (courseRes.error || !courseRes.data) {
        setError(courseRes.error?.message ?? 'No course found')
        setLoading(false)
        return
      }

      const course = courseRes.data

      const [sessionsRes, attendanceRes] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, session_number, session_date')
          .eq('course_id', course.id)
          .neq('status', 'not_started')
          .order('session_number'),
        supabase
          .from('attendance_records')
          .select('session_id')
          .eq('student_pgp_id', user.student_pgp_id),
      ])

      if (sessionsRes.error) {
        setError(sessionsRes.error.message)
        setLoading(false)
        return
      }
      if (attendanceRes.error) {
        setError(attendanceRes.error.message)
        setLoading(false)
        return
      }

      const attendedSessionIds = new Set(attendanceRes.data.map((r) => r.session_id))

      const rows = sessionsRes.data.map((s) => ({
        session_number: s.session_number,
        session_date: s.session_date,
        attended: attendedSessionIds.has(s.id),
      }))

      setStudentName(studentRes.data.name)
      setTotalSessions(course.total_sessions)
      setSessionRows(rows)
      setLoading(false)
    }

    loadDashboard()
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

  const attendedCount = sessionRows.filter((row) => row.attended).length

  return (
    <PageShell>
      <Card>
        <p className="text-sm font-medium text-maroon-600">Student Dashboard</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">{studentName}</h1>
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-semibold text-gray-900">
            Attended: {attendedCount} / {sessionRows.length}
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-sm text-gray-500">
            Course plan: {totalSessions} sessions total
          </span>
        </div>
      </Card>

      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Session History</h2>
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
              {sessionRows.map((row, i) => (
                <tr
                  key={row.session_number}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-6 py-3 font-medium text-gray-900">
                    {row.session_number}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{row.session_date}</td>
                  <td className="px-6 py-3">
                    <span
                      className={
                        row.attended
                          ? 'inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700'
                          : 'inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700'
                      }
                    >
                      {row.attended ? 'Present' : 'Absent'}
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
  return <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">{children}</div>
}
