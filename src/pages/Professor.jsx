import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

const SESSION_NUMBER = 16
const TOKEN_INTERVAL_SECONDS = 15

function generateToken() {
  return Math.random().toString(36).substring(2, 10)
}

function buildScanUrl(token) {
  return `${window.location.origin}${window.location.pathname}#/scan?session=${SESSION_NUMBER}&token=${token}`
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    })
  })
}

export default function Professor() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [token, setToken] = useState('')
  const [countdown, setCountdown] = useState(TOKEN_INTERVAL_SECONDS)
  const [presentCount, setPresentCount] = useState(0)
  const [manuallyMarked, setManuallyMarked] = useState([])

  useEffect(() => {
    async function loadSession() {
      setLoading(true)
      setError('')

      const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (courseError || !course) {
        setError(courseError?.message ?? 'No course found')
        setLoading(false)
        return
      }

      const { data: sessionRow, error: sessionError } = await supabase
        .from('sessions')
        .select('id, session_number, session_date, status')
        .eq('course_id', course.id)
        .eq('session_number', SESSION_NUMBER)
        .maybeSingle()

      if (sessionError || !sessionRow) {
        setError(sessionError?.message ?? `Session ${SESSION_NUMBER} not found`)
        setLoading(false)
        return
      }

      setSession(sessionRow)
      setLoading(false)
    }

    loadSession()
  }, [])

  useEffect(() => {
    if (session?.status !== 'qr_live') return

    async function rotateToken() {
      const newToken = generateToken()
      setToken(newToken)
      setCountdown(TOKEN_INTERVAL_SECONDS)

      const { error: tokenError } = await supabase
        .from('sessions')
        .update({ current_token: newToken })
        .eq('id', session.id)

      if (tokenError) {
        console.error('Failed to sync current_token:', tokenError.message)
      }
    }

    rotateToken()

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          rotateToken()
          return TOKEN_INTERVAL_SECONDS
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [session?.status, session?.id])

  async function refreshAttendance() {
    const { count, error: countError } = await supabase
      .from('attendance_records')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session.id)

    if (!countError) setPresentCount(count ?? 0)

    const { data: manualData, error: manualError } = await supabase
      .from('attendance_records')
      .select('student_pgp_id, marked_at, students(name)')
      .eq('session_id', session.id)
      .eq('method', 'manual_entry')
      .order('marked_at', { ascending: false })

    if (!manualError) setManuallyMarked(manualData ?? [])
  }

  useEffect(() => {
    if (session?.status !== 'qr_live') return

    refreshAttendance()

    const channel = supabase
      .channel(`attendance-records-session-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_records',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          if (payload.new?.session_id !== session.id) return
          refreshAttendance()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.status, session?.id])

  async function handleStart() {
    setStarting(true)
    setStartError('')

    let position
    try {
      position = await getCurrentPosition()
    } catch (geoError) {
      setStarting(false)
      setStartError(
        `GPS reference is required to start the session. ${
          geoError.message || 'Location access was denied or is unavailable.'
        }`,
      )
      return
    }

    const { data, error: updateError } = await supabase
      .from('sessions')
      .update({
        status: 'qr_live',
        reference_lat: position.coords.latitude,
        reference_lng: position.coords.longitude,
        qr_started_at: new Date().toISOString(),
      })
      .eq('id', session.id)
      .select()
      .single()

    setStarting(false)

    if (updateError) {
      setStartError(updateError.message)
      return
    }

    setSession(data)
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

  return (
    <PageShell>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-maroon-600">Professor Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
              Session {session.session_number} · {session.session_date}
            </h1>
          </div>
          <Link
            to="/professor/anomalies"
            className="mt-1 shrink-0 text-sm font-medium text-maroon-600 hover:text-maroon-700"
          >
            View Anomalies →
          </Link>
        </div>

        {session.status === 'not_started' && (
          <div className="mt-10 flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-gray-500">This session hasn't started yet.</p>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="rounded-lg bg-maroon-600 px-8 py-3 text-lg font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {starting ? 'Starting…' : 'Start Session'}
            </button>
            {startError && (
              <p role="alert" className="max-w-sm rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {startError}
              </p>
            )}
          </div>
        )}

        {session.status === 'qr_live' && (
          <div className="mt-10 flex flex-col items-center gap-12">
            <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
              <div className="w-full max-w-[380px] rounded-2xl border-4 border-maroon-600 bg-white p-4 shadow-lg sm:p-8">
                <QRCodeSVG
                  value={buildScanUrl(token)}
                  size={340}
                  style={{ width: '100%', height: 'auto' }}
                />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Refreshes in
                </p>
                <p className="text-7xl font-bold tabular-nums text-maroon-600">{countdown}s</p>
              </div>
            </div>

            <div className="w-full rounded-xl bg-maroon-50 px-6 py-10 text-center">
              <p className="text-8xl font-bold tabular-nums text-gray-900">{presentCount}</p>
              <p className="mt-2 text-xl font-medium text-gray-600">students marked present</p>
            </div>
          </div>
        )}

        {session.status !== 'not_started' && session.status !== 'qr_live' && (
          <p className="mt-10 text-gray-500">
            Session status: <span className="font-medium">{session.status}</span>
          </p>
        )}
      </Card>

      {session.status === 'qr_live' && (
        <ManualOverrideCard
          sessionId={session.id}
          manuallyMarked={manuallyMarked}
          onMarked={refreshAttendance}
        />
      )}
    </PageShell>
  )
}

function ManualOverrideCard({ sessionId, manuallyMarked, onMarked }) {
  const [students, setStudents] = useState([])
  const [searchText, setSearchText] = useState('')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [marking, setMarking] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    async function loadStudents() {
      const { data, error } = await supabase.from('students').select('pgp_id, name').order('name')
      if (!error) setStudents(data ?? [])
    }
    loadStudents()
  }, [])

  const filteredStudents =
    searchText.trim() === ''
      ? []
      : students
          .filter((s) => {
            const q = searchText.toLowerCase()
            return s.name.toLowerCase().includes(q) || s.pgp_id.toLowerCase().includes(q)
          })
          .slice(0, 8)

  async function handleMarkPresent() {
    if (!selectedStudent) return

    setMarking(true)
    setMessage({ type: '', text: '' })

    const { data: existing, error: existingError } = await supabase
      .from('attendance_records')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_pgp_id', selectedStudent.pgp_id)
      .maybeSingle()

    if (existingError) {
      setMarking(false)
      setMessage({ type: 'error', text: existingError.message })
      return
    }

    if (existing) {
      setMarking(false)
      setMessage({ type: 'info', text: `${selectedStudent.name} is already marked present.` })
      return
    }

    const { error: insertError } = await supabase.from('attendance_records').insert({
      session_id: sessionId,
      student_pgp_id: selectedStudent.pgp_id,
      method: 'manual_entry',
      device_fingerprint: null,
      gps_lat: null,
      gps_lng: null,
      gps_match: null,
      verification_tier: 'manual',
      flagged: false,
      flag_reason: null,
    })

    if (insertError) {
      setMarking(false)
      setMessage({ type: 'error', text: insertError.message })
      return
    }

    setMessage({ type: 'success', text: `${selectedStudent.name} marked present.` })
    setSelectedStudent(null)
    setSearchText('')

    await onMarked()
    setMarking(false)
  }

  return (
    <div className="mt-6 rounded-xl bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-base font-semibold text-gray-900">Manual Override — No Device</h2>
      <p className="mt-1 text-sm text-gray-500">
        For students without a phone, tablet, or laptop this session.
      </p>

      <div className="relative mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value)
              setSelectedStudent(null)
              setMessage({ type: '', text: '' })
            }}
            placeholder="Search by name or PGP ID…"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
          {searchText && !selectedStudent && filteredStudents.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {filteredStudents.map((s) => (
                <li key={s.pgp_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudent(s)
                      setSearchText(`${s.name} (${s.pgp_id})`)
                    }}
                    className="block w-full px-3.5 py-2 text-left text-sm hover:bg-maroon-50"
                  >
                    <span className="font-medium text-gray-900">{s.name}</span>
                    <span className="ml-2 text-gray-500">{s.pgp_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={handleMarkPresent}
          disabled={!selectedStudent || marking}
          className="rounded-lg bg-maroon-600 px-6 py-2.5 font-medium whitespace-nowrap text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {marking ? 'Marking…' : 'Mark Present'}
        </button>
      </div>

      {message.text && (
        <p
          role="alert"
          className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ${
            message.type === 'error'
              ? 'bg-red-50 text-red-700'
              : message.type === 'info'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-green-50 text-green-700'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-6">
        <p className="text-sm font-medium text-gray-700">
          Manually marked ({manuallyMarked.length})
        </p>
        {manuallyMarked.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">No manual entries yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {manuallyMarked.map((row) => (
              <li
                key={row.student_pgp_id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="font-medium text-gray-900">{row.students?.name}</span>
                <span className="text-gray-500">{row.student_pgp_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
  return <div className="rounded-xl bg-white p-6 shadow-lg sm:p-10 lg:p-12">{children}</div>
}
