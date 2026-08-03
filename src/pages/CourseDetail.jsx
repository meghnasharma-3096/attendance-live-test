import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { formatDateIST, getTodayISTDateString } from '../lib/dateFormat.js'
import UserMenu from '../components/UserMenu.jsx'
import QrScanner from '../components/QrScanner.jsx'

function displaySessionDate(session) {
  const dateString = session.status === 'not_started' ? getTodayISTDateString() : session.session_date
  return formatDateIST(dateString)
}

function parseScanUrl(decodedText) {
  try {
    const url = new URL(decodedText)
    const hash = url.hash
    const queryStart = hash.indexOf('?')
    const queryString = queryStart >= 0 ? hash.slice(queryStart + 1) : ''
    const params = new URLSearchParams(queryString)
    return { session: params.get('session'), token: params.get('token') }
  } catch {
    return { session: null, token: null }
  }
}

export default function CourseDetail() {
  const { user } = useAuth()
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [studentName, setStudentName] = useState('')
  const [course, setCourse] = useState(null)
  const [sessionRows, setSessionRows] = useState([])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanError, setScanError] = useState('')

  useEffect(() => {
    if (!user?.student_pgp_id) return

    async function loadCourseDetail() {
      setLoading(true)
      setError('')

      const [studentRes, courseRes] = await Promise.all([
        supabase.from('students').select('name').eq('pgp_id', user.student_pgp_id).single(),
        supabase
          .from('courses')
          .select('id, name, professor_name, total_sessions')
          .eq('id', courseId)
          .maybeSingle(),
      ])

      if (studentRes.error) {
        setError(studentRes.error.message)
        setLoading(false)
        return
      }
      if (courseRes.error || !courseRes.data) {
        setError(courseRes.error?.message ?? 'Course not found')
        setLoading(false)
        return
      }

      const { data: sessionsData, error: sessionsError } = await supabase
        .from('sessions')
        .select('id, session_number, session_date, status')
        .eq('course_id', courseId)
        .order('session_number')

      if (sessionsError) {
        setError(sessionsError.message)
        setLoading(false)
        return
      }

      const sessionIds = (sessionsData ?? []).map((s) => s.id)
      let attendedIds = new Set()

      if (sessionIds.length > 0) {
        const { data: attendanceData, error: attendanceError } = await supabase
          .from('attendance_records')
          .select('session_id')
          .eq('student_pgp_id', user.student_pgp_id)
          .in('session_id', sessionIds)

        if (attendanceError) {
          setError(attendanceError.message)
          setLoading(false)
          return
        }

        attendedIds = new Set(attendanceData.map((r) => r.session_id))
      }

      const rows = (sessionsData ?? []).map((s) => ({
        id: s.id,
        session_number: s.session_number,
        session_date: s.session_date,
        status: s.status,
        attended: attendedIds.has(s.id),
      }))

      setStudentName(studentRes.data.name)
      setCourse(courseRes.data)
      setSessionRows(rows)
      setLoading(false)
    }

    loadCourseDetail()
  }, [user?.student_pgp_id, courseId])

  function handleScanResult(decodedText) {
    setScannerOpen(false)
    setScanError('')

    const { session, token } = parseScanUrl(decodedText)

    if (!session || !token) {
      setScanError('This QR code is not a valid attendance code.')
      return
    }

    navigate(`/scan?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`)
  }

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

  const conductedRows = sessionRows.filter((row) => row.status !== 'not_started')
  const attendedCount = conductedRows.filter((row) => row.attended).length

  return (
    <PageShell>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link to="/student" className="text-sm font-medium text-gray-500 hover:text-gray-700">
              ← All courses
            </Link>
            <p className="mt-2 text-sm font-medium text-maroon-600">{studentName}</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">{course.name}</h1>
            <p className="mt-1 text-sm text-gray-500">{course.professor_name}</p>
          </div>
          <UserMenu />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-semibold text-gray-900">
            Attended: {attendedCount} / {conductedRows.length}
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-sm text-gray-500">
            Course plan: {course.total_sessions} sessions total
          </span>
        </div>

        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="mt-6 w-full rounded-lg bg-maroon-600 px-6 py-3 text-lg font-medium text-white transition hover:bg-maroon-700 sm:w-auto"
        >
          Scan QR Code
        </button>
        {scanError && (
          <p role="alert" className="mt-3 max-w-sm rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {scanError}
          </p>
        )}
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
                <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-3 font-medium text-gray-900">{row.session_number}</td>
                  <td className="px-6 py-3 text-gray-600">{displaySessionDate(row)}</td>
                  <td className="px-6 py-3">
                    {row.status === 'not_started' ? (
                      <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                        Upcoming
                      </span>
                    ) : (
                      <span
                        className={
                          row.attended
                            ? 'inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700'
                            : 'inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700'
                        }
                      >
                        {row.attended ? 'Present' : 'Absent'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {scannerOpen && (
        <QrScanner onScan={handleScanResult} onClose={() => setScannerOpen(false)} />
      )}
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
