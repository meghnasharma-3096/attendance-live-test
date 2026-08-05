import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabaseClient.js'
import { formatDateIST, formatDateTimeIST, getTodayISTDateString } from '../lib/dateFormat.js'
import { courseShortCode, downloadCsv, rowsToCsv } from '../lib/csv.js'
import UserMenu from '../components/UserMenu.jsx'

const TIMING_OPTIONS = [
  { value: 'start', label: 'Start of class' },
  { value: 'end', label: 'End of class' },
  { value: 'both', label: 'Both' },
]

const MID_CLASS_WINDOW_MS = 60000

// Best-effort client-side safety net for sessions a professor forgets to end. There is no
// server-side scheduled job in this architecture (no backend beyond Supabase + this SPA),
// so this can only fire while a professor's own browser tab still has this page open — if
// they close the laptop, nothing here runs and the session stays open indefinitely. A real
// production version would enforce this server-side (e.g. a Supabase Edge Function on a
// pg_cron schedule) so it applies even with no browser involved at all. Be honest about this
// limitation if asked — it is a mitigation, not a guarantee.
const STALE_WARNING_MS = 2 * 60 * 60 * 1000 // 2 hours
const STALE_CUTOFF_MS = 3 * 60 * 60 * 1000 // 3 hours
const STALE_CHECK_INTERVAL_MS = 30 * 1000

function generateToken() {
  return Math.random().toString(36).substring(2, 10)
}

function buildScanUrl(sessionId, token, phase) {
  return `${window.location.origin}${window.location.pathname}#/scan?session=${sessionId}&token=${token}&phase=${phase}`
}

// Never let laptop_network read as identical to phone_gps in a report — the lower-precision
// tier must stay visually distinct so it isn't mistaken for the higher-confidence GPS check.
function verificationTierLabel(tier) {
  if (tier === 'phone_gps') return 'Phone (GPS)'
  if (tier === 'laptop_network') return 'Laptop (network, lower precision)'
  if (tier === 'manual') return 'Manual override'
  return tier ?? ''
}

function displaySessionDate(session) {
  const todayString = getTodayISTDateString()
  const neverGoneLive = session.status === 'not_started' || (session.status === 'awaiting_end' && !session.current_phase)
  const isStale = neverGoneLive && session.session_date < todayString
  return formatDateIST(isStale ? todayString : session.session_date)
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

export default function ProfessorLive() {
  const { sessionId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [course, setCourse] = useState(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState('')
  const [durationInput, setDurationInput] = useState('')
  const [timingConfig, setTimingConfig] = useState('start')
  const [midClassEnabled, setMidClassEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [isReverification, setIsReverification] = useState(false)
  const [presentCount, setPresentCount] = useState(0)
  const [manuallyMarked, setManuallyMarked] = useState([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [switchingManual, setSwitchingManual] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [staleWarning, setStaleWarning] = useState(false)
  const [endingStale, setEndingStale] = useState(false)
  const [staleError, setStaleError] = useState('')
  const autoEndTriggeredRef = useRef(false)

  useEffect(() => {
    async function loadSession() {
      setLoading(true)
      setError('')

      const { data: sessionRow, error: sessionError } = await supabase
        .from('sessions')
        .select(
          'id, course_id, session_number, session_date, status, qr_duration_seconds, timing_config, mid_class_enabled, current_phase, mid_class_window_expires_at, qr_started_at, cancellation_reason',
        )
        .eq('id', sessionId)
        .maybeSingle()

      if (sessionError || !sessionRow) {
        setError(sessionError?.message ?? 'Session not found')
        setLoading(false)
        return
      }

      const { data: courseRow, error: courseError } = await supabase
        .from('courses')
        .select('id, name, default_qr_duration_seconds')
        .eq('id', sessionRow.course_id)
        .maybeSingle()

      if (courseError || !courseRow) {
        setError(courseError?.message ?? 'Course not found')
        setLoading(false)
        return
      }

      setCourse(courseRow)
      setSession(sessionRow)
      setDurationInput(String(sessionRow.qr_duration_seconds ?? courseRow.default_qr_duration_seconds))
      setTimingConfig(sessionRow.timing_config ?? 'start')
      setMidClassEnabled(sessionRow.mid_class_enabled ?? false)
      setLoading(false)
    }

    loadSession()
  }, [sessionId])

  useEffect(() => {
    if (session?.status !== 'qr_live') return

    const durationSeconds = session.qr_duration_seconds ?? 60
    const phase = session.current_phase ?? 'start'

    async function rotateToken() {
      const newToken = generateToken()
      setToken(newToken)
      setCountdown(durationSeconds)

      const { error: tokenError } = await supabase
        .from('sessions')
        .update({ current_token: newToken })
        .eq('id', session.id)

      if (tokenError) {
        console.error('Failed to sync current_token:', tokenError.message)
      }
    }

    rotateToken()

    const countdownTimer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          rotateToken()
          return durationSeconds
        }
        return prev - 1
      })
    }, 1000)

    let reverifyTriggerTimer = null
    let reverifyWindowTimer = null

    if (session.mid_class_enabled) {
      const delayMs = (60 + Math.random() * 240) * 1000 // random point between 1 and 5 minutes

      reverifyTriggerTimer = setTimeout(async () => {
        setIsReverification(true)
        await rotateToken()

        const expiresAt = new Date(Date.now() + MID_CLASS_WINDOW_MS).toISOString()
        await supabase
          .from('sessions')
          .update({ mid_class_window_expires_at: expiresAt })
          .eq('id', session.id)

        reverifyWindowTimer = setTimeout(async () => {
          setIsReverification(false)

          await supabase
            .from('attendance_records')
            .update({ mid_class_verified: false })
            .eq('session_id', session.id)
            .eq('phase', phase)
            .is('mid_class_verified', null)

          await supabase
            .from('sessions')
            .update({ mid_class_window_expires_at: null })
            .eq('id', session.id)
        }, MID_CLASS_WINDOW_MS)
      }, delayMs)
    }

    return () => {
      clearInterval(countdownTimer)
      if (reverifyTriggerTimer) clearTimeout(reverifyTriggerTimer)
      if (reverifyWindowTimer) clearTimeout(reverifyWindowTimer)
    }
  }, [session?.status, session?.id, session?.qr_duration_seconds, session?.mid_class_enabled, session?.current_phase])

  async function refreshAttendance() {
    const phase = session.current_phase ?? 'start'

    const { count, error: countError } = await supabase
      .from('attendance_records')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session.id)
      .eq('phase', phase)

    if (!countError) setPresentCount(count ?? 0)

    const { data: manualData, error: manualError } = await supabase
      .from('attendance_records')
      .select('student_pgp_id, marked_at, students(name)')
      .eq('session_id', session.id)
      .eq('phase', phase)
      .eq('method', 'manual_entry')
      .order('marked_at', { ascending: false })

    if (!manualError) setManuallyMarked(manualData ?? [])
  }

  useEffect(() => {
    if (session?.status !== 'qr_live' && session?.status !== 'manual_only') return

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

  // Stale-session watchdog — see the STALE_* constants above for the architectural caveat.
  // qr_started_at is stamped whenever a phase actually goes live (goLive) and is left
  // untouched by the switch-to-manual-mode fallback, so it doubles as "how long has the
  // current phase been open" for qr_live and manual_only alike. For awaiting_end, it still
  // refers to when the *previous* (start) phase opened — there's no separate timestamp for
  // "entered awaiting_end", but if a professor hasn't returned to open the end round in
  // 2-3+ hours since the start round began, that's just as clearly forgotten.
  useEffect(() => {
    const isOpenLiveState =
      session?.status === 'qr_live' ||
      session?.status === 'manual_only' ||
      (session?.status === 'awaiting_end' && session?.current_phase != null)

    if (!isOpenLiveState || !session?.qr_started_at) {
      setStaleWarning(false)
      return
    }

    autoEndTriggeredRef.current = false
    const openedAtMs = new Date(session.qr_started_at).getTime()

    function checkStaleness() {
      const elapsedMs = Date.now() - openedAtMs

      if (elapsedMs >= STALE_CUTOFF_MS) {
        if (!autoEndTriggeredRef.current) {
          autoEndTriggeredRef.current = true
          handleForceEndStaleSession()
        }
        return
      }

      setStaleWarning(elapsedMs >= STALE_WARNING_MS)
    }

    checkStaleness()
    const staleCheckTimer = setInterval(checkStaleness, STALE_CHECK_INTERVAL_MS)

    return () => clearInterval(staleCheckTimer)
  }, [session?.status, session?.current_phase, session?.qr_started_at, session?.id])

  // Deliberately distinct from handleEndSession: that function's both-timing branch can
  // route back into 'awaiting_end' (the normal handoff to a second round), which would be a
  // no-op for a session that's already stuck in awaiting_end — defeating the point of a hard
  // cutoff. A session flagged as forgotten always closes outright, regardless of phase.
  async function handleForceEndStaleSession() {
    setEndingStale(true)
    setStaleError('')

    await resolvePendingMidClassVerification()

    const { data, error: updateError } = await supabase
      .from('sessions')
      .update({ status: 'ended' })
      .eq('id', session.id)
      .select()
      .single()

    setEndingStale(false)

    if (updateError) {
      setStaleError(updateError.message)
      return
    }

    setStaleWarning(false)
    setSession(data)
  }

  async function goLive(phase, extraFields = {}) {
    setStarting(true)
    setStartError('')

    let position
    try {
      position = await getCurrentPosition()
    } catch (geoError) {
      setStarting(false)
      setStartError(
        `GPS reference is required to start attendance. ${
          geoError.message || 'Location access was denied or is unavailable.'
        }`,
      )
      return
    }

    const { data, error: updateError } = await supabase
      .from('sessions')
      .update({
        ...extraFields,
        status: 'qr_live',
        current_phase: phase,
        reference_lat: position.coords.latitude,
        reference_lng: position.coords.longitude,
        qr_started_at: new Date().toISOString(),
        session_date: getTodayISTDateString(),
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

  async function handleStart() {
    const config = {
      timing_config: timingConfig,
      mid_class_enabled: midClassEnabled,
      qr_duration_seconds: Number(durationInput),
    }

    if (timingConfig === 'end') {
      setStarting(true)
      setStartError('')

      const { data, error: updateError } = await supabase
        .from('sessions')
        .update({ ...config, status: 'awaiting_end' })
        .eq('id', session.id)
        .select()
        .single()

      setStarting(false)

      if (updateError) {
        setStartError(updateError.message)
        return
      }

      setSession(data)
      return
    }

    await goLive('start', config)
  }

  function handleOpenEndRound() {
    return goLive('end')
  }

  // If a mid-class window is still open when the professor ends the session or switches
  // to manual mode, there's no more chance for students to respond — resolve it now
  // instead of leaving those records ambiguously null forever. A null window means either
  // the check never fired or it already resolved naturally, so this is a safe no-op then.
  async function resolvePendingMidClassVerification() {
    if (!session.mid_class_window_expires_at) return

    await supabase
      .from('attendance_records')
      .update({ mid_class_verified: false })
      .eq('session_id', session.id)
      .eq('phase', session.current_phase ?? 'start')
      .is('mid_class_verified', null)

    await supabase.from('sessions').update({ mid_class_window_expires_at: null }).eq('id', session.id)
  }

  async function handleSwitchToManual() {
    const confirmed = window.confirm(
      'This will stop the QR code and rely on manual entry only for the rest of this session — continue?',
    )
    if (!confirmed) return

    setSwitchingManual(true)
    setSwitchError('')

    await resolvePendingMidClassVerification()

    const { data, error: updateError } = await supabase
      .from('sessions')
      .update({ status: 'manual_only' })
      .eq('id', session.id)
      .select()
      .single()

    setSwitchingManual(false)

    if (updateError) {
      setSwitchError(updateError.message)
      return
    }

    setSession(data)
  }

  async function handleExportSession() {
    setExporting(true)
    setExportError('')

    const [enrollRes, attendanceRes] = await Promise.all([
      supabase.from('enrollments').select('students(pgp_id, name)').eq('course_id', course.id),
      supabase
        .from('attendance_records')
        .select('student_pgp_id, method, phase, marked_at, verification_tier, flagged, flag_reason')
        .eq('session_id', session.id),
    ])

    setExporting(false)

    if (enrollRes.error) {
      setExportError(enrollRes.error.message)
      return
    }
    if (attendanceRes.error) {
      setExportError(attendanceRes.error.message)
      return
    }

    const students = (enrollRes.data ?? [])
      .map((e) => e.students)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))

    const recordsByStudent = new Map()
    for (const record of attendanceRes.data ?? []) {
      const list = recordsByStudent.get(record.student_pgp_id) ?? []
      list.push(record)
      recordsByStudent.set(record.student_pgp_id, list)
    }

    const rows = [
      [
        'PGP ID',
        'Name',
        'Status',
        'Method',
        'Phase',
        'Marked At (IST)',
        'Verification Tier',
        'Flagged',
        'Flag Reason',
      ],
    ]

    for (const student of students) {
      const records = recordsByStudent.get(student.pgp_id) ?? []

      if (records.length === 0) {
        rows.push([student.pgp_id, student.name, 'Absent', 'none', '', '', '', '', ''])
        continue
      }

      for (const record of records) {
        rows.push([
          student.pgp_id,
          student.name,
          'Present',
          record.method,
          record.phase ?? '',
          record.marked_at ? formatDateTimeIST(record.marked_at) : '',
          verificationTierLabel(record.verification_tier),
          record.flagged ? 'yes' : 'no',
          record.flag_reason ?? '',
        ])
      }
    }

    const filename = `${courseShortCode(course.name)}_Session${session.session_number}_Attendance_${getTodayISTDateString()}.csv`
    downloadCsv(filename, rowsToCsv(rows))
  }

  async function handleEndSession() {
    setEnding(true)
    setEndError('')

    await resolvePendingMidClassVerification()

    const nextStatus =
      session.timing_config === 'both' && session.current_phase === 'start' ? 'awaiting_end' : 'ended'

    const { data, error: updateError } = await supabase
      .from('sessions')
      .update({ status: nextStatus })
      .eq('id', session.id)
      .select()
      .single()

    setEnding(false)

    if (updateError) {
      setEndError(updateError.message)
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
        <Link
          to="/professor"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Calendar
        </Link>

        {staleWarning && (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border-2 border-red-400 bg-red-50 p-4 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-sm font-semibold text-red-800">
              This session has been open for over 2 hours — did you forget to end it?
            </p>
            <button
              type="button"
              onClick={handleForceEndStaleSession}
              disabled={endingStale}
              className="shrink-0 rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {endingStale ? 'Ending…' : 'End Session Now'}
            </button>
          </div>
        )}
        {staleError && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {staleError}
          </p>
        )}

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-maroon-600">Professor Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
              Session {session.session_number} · {displaySessionDate(session)}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{course.name}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <Link
              to="/professor/anomalies"
              className="text-sm font-medium text-maroon-600 hover:text-maroon-700"
            >
              View Anomalies →
            </Link>
            <UserMenu />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={handleExportSession}
            disabled={exporting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? 'Preparing CSV…' : 'Download Attendance (CSV)'}
          </button>
          {exportError && (
            <p role="alert" className="text-sm text-red-700">
              {exportError}
            </p>
          )}
        </div>

        {session.status === 'not_started' && (
          <div className="mt-10 flex flex-col items-center gap-5 py-8 text-center">
            <p className="text-gray-500">This session hasn't started yet.</p>

            <div className="w-full max-w-sm text-left">
              <p className="text-sm font-medium text-gray-700">Take attendance at:</p>
              <div className="mt-2 flex gap-2">
                {TIMING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTimingConfig(opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      timingConfig === opt.value
                        ? 'border-maroon-600 bg-maroon-50 text-maroon-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex w-full max-w-sm cursor-pointer items-center justify-between gap-4">
              <span className="text-sm font-medium text-gray-700">
                Enable one random mid-class re-verification
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={midClassEnabled}
                onClick={() => setMidClassEnabled((v) => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  midClassEnabled ? 'bg-maroon-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    midClassEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>

            <div className="flex items-center gap-2">
              <label htmlFor="qr-duration" className="text-sm font-medium text-gray-700">
                QR rotation
              </label>
              <input
                id="qr-duration"
                type="number"
                min="1"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                className="w-24 rounded-lg border border-gray-300 px-3.5 py-2 text-center text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
              />
              <span className="text-sm text-gray-500">seconds</span>
            </div>
            <p className="text-xs text-gray-400">
              Defaults to the course setting ({course.default_qr_duration_seconds}s) — override just
              for this session if needed.
            </p>

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

        {session.status === 'awaiting_end' && (
          <div className="mt-10 flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-gray-500">
              {session.current_phase === 'start'
                ? 'Start-of-class attendance closed. Open the second round when class is ending.'
                : 'Waiting until end of class.'}
            </p>
            <button
              type="button"
              onClick={handleOpenEndRound}
              disabled={starting}
              className="rounded-lg bg-maroon-600 px-8 py-3 text-lg font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {starting ? 'Opening…' : 'Open End-of-Class Attendance'}
            </button>
            {startError && (
              <p role="alert" className="max-w-sm rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {startError}
              </p>
            )}
          </div>
        )}

        {(session.status === 'qr_live' || session.status === 'manual_only') && (
          <div className="mt-10 flex flex-col items-center gap-8">
            {session.status === 'qr_live' && (
              <>
                {isReverification && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold tracking-wide text-amber-700 uppercase">
                    Re-verification check
                  </span>
                )}

                <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
                  <div className="w-full max-w-[380px] rounded-2xl border-4 border-maroon-600 bg-white p-4 shadow-lg sm:p-8">
                    <QRCodeSVG
                      value={buildScanUrl(session.id, token, session.current_phase ?? 'start')}
                      size={340}
                      style={{ width: '100%', height: 'auto' }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                      {session.current_phase === 'end' ? 'End-of-class · Refreshes in' : 'Refreshes in'}
                    </p>
                    <p className="text-7xl font-bold tabular-nums text-maroon-600">{countdown}s</p>
                  </div>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleSwitchToManual}
                    disabled={switchingManual}
                    className="text-xs text-gray-400 underline decoration-dotted transition hover:text-gray-600 disabled:cursor-not-allowed"
                  >
                    {switchingManual
                      ? 'Switching…'
                      : 'Having trouble with the QR code? Switch to manual mode'}
                  </button>
                  {switchError && <p className="mt-1 text-xs text-red-600">{switchError}</p>}
                </div>
              </>
            )}

            {session.status === 'manual_only' && (
              <div className="w-full max-w-sm rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                QR code stopped — this session is in manual-only mode. Use Manual Override below to
                mark attendance for the rest of this session.
              </div>
            )}

            <div className="w-full rounded-xl bg-maroon-50 px-6 py-10 text-center">
              <p className="text-8xl font-bold tabular-nums text-gray-900">{presentCount}</p>
              <p className="mt-2 text-xl font-medium text-gray-600">students marked present</p>
            </div>

            <button
              type="button"
              onClick={handleEndSession}
              disabled={ending}
              className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {ending ? 'Ending…' : 'End Session'}
            </button>
            {endError && (
              <p role="alert" className="max-w-sm rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {endError}
              </p>
            )}
          </div>
        )}

        {session.status === 'ended' && <p className="mt-10 text-gray-500">Session ended.</p>}

        {session.status === 'cancelled' && (
          <div className="mt-10 rounded-lg bg-gray-100 px-4 py-3 text-center text-sm text-gray-500">
            This session was cancelled
            {session.cancellation_reason ? ` — ${session.cancellation_reason}` : ''}.
          </div>
        )}
      </Card>

      {(session.status === 'qr_live' || session.status === 'manual_only') && (
        <ManualOverrideCard
          sessionId={session.id}
          phase={session.current_phase ?? 'start'}
          manuallyMarked={manuallyMarked}
          onMarked={refreshAttendance}
        />
      )}
    </PageShell>
  )
}

function ManualOverrideCard({ sessionId, phase, manuallyMarked, onMarked }) {
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
      .eq('phase', phase)
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
      phase,
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
