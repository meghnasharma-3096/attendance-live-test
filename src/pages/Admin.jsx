import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import {
  addDaysToDateString,
  formatDateIST,
  getTodayISTDateString,
  nextOccurrenceOfDay,
} from '../lib/dateFormat.js'
import { courseShortCode, downloadCsv, rowsToCsv } from '../lib/csv.js'
import UserMenu from '../components/UserMenu.jsx'

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_STYLES = {
  not_started: 'bg-gray-100 text-gray-600',
  qr_live: 'bg-green-100 text-green-700',
  awaiting_end: 'bg-amber-50 text-amber-700',
  manual_only: 'bg-orange-50 text-orange-700',
  ended: 'bg-blue-50 text-blue-700',
}

function statusLabel(status) {
  if (status === 'not_started') return 'Not started'
  if (status === 'qr_live') return 'Live now'
  if (status === 'awaiting_end') return 'Awaiting end-of-class'
  if (status === 'manual_only') return 'Manual mode'
  if (status === 'ended') return 'Ended'
  return status
}

function displaySessionDate(session) {
  const todayString = getTodayISTDateString()
  const neverGoneLive =
    session.status === 'not_started' || (session.status === 'awaiting_end' && !session.current_phase)
  const isStale = neverGoneLive && session.session_date < todayString
  return formatDateIST(isStale ? todayString : session.session_date)
}

export default function Admin() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState([])
  const [students, setStudents] = useState([])
  const [selectedCourseId, setSelectedCourseId] = useState(null)

  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [sessions, setSessions] = useState([])

  const [durationInput, setDurationInput] = useState('')
  const [savingDuration, setSavingDuration] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  const [exportingCourse, setExportingCourse] = useState(false)
  const [exportError, setExportError] = useState('')

  const [functionalSlots, setFunctionalSlots] = useState([])
  const [weeksInput, setWeeksInput] = useState('4')
  const [generating, setGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState(null)

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  useEffect(() => {
    if (!user) return

    async function loadData() {
      setLoading(true)
      setError('')

      const [coursesRes, studentsRes] = await Promise.all([
        supabase
          .from('courses')
          .select('id, name, professor_name, total_sessions, default_qr_duration_seconds')
          .order('created_at'),
        supabase.from('students').select('pgp_id, name').order('name'),
      ])

      if (coursesRes.error || !coursesRes.data || coursesRes.data.length === 0) {
        setError(coursesRes.error?.message ?? 'No courses found')
        setLoading(false)
        return
      }
      if (studentsRes.error) {
        setError(studentsRes.error.message)
        setLoading(false)
        return
      }

      setCourses(coursesRes.data)
      setStudents(studentsRes.data ?? [])
      setSelectedCourseId(coursesRes.data[0].id)
      setLoading(false)
    }

    loadData()
  }, [user])

  useEffect(() => {
    if (!selectedCourse) return

    setDurationInput(String(selectedCourse.default_qr_duration_seconds))
    setSaveMessage(null)
    setGenerateMessage(null)

    async function loadSessions() {
      setSessionsLoading(true)
      setSessionsError('')

      const { data, error: sessionsErr } = await supabase
        .from('sessions')
        .select('session_number, session_date, status, current_phase, timing_config, mid_class_enabled')
        .eq('course_id', selectedCourse.id)
        .order('session_number')

      if (sessionsErr) {
        setSessionsError(sessionsErr.message)
        setSessionsLoading(false)
        return
      }

      setSessions(data ?? [])
      setSessionsLoading(false)
    }

    async function loadFunctionalSlots() {
      const shortCode = courseShortCode(selectedCourse.name)
      const { data } = await supabase
        .from('timetable_slots')
        .select('id, day_of_week')
        .eq('course_name', shortCode)
        .eq('is_functional', true)

      setFunctionalSlots(data ?? [])
    }

    loadSessions()
    loadFunctionalSlots()
  }, [selectedCourse?.id])

  const slotDays = [...new Set(functionalSlots.map((s) => s.day_of_week))].sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
  )
  const slotsPerWeek = slotDays.length
  const existingCount = sessions.length
  const maxSessionNumber = existingCount > 0 ? Math.max(...sessions.map((s) => s.session_number)) : 0
  const weeksSoFar = slotsPerWeek > 0 ? Math.ceil(existingCount / slotsPerWeek) : 0

  async function handleGenerateSessions() {
    setGenerateMessage(null)

    const weeks = Number(weeksInput)
    if (!Number.isInteger(weeks) || weeks < 1) {
      setGenerateMessage({ type: 'error', text: 'Enter a whole number of weeks (1 or more).' })
      return
    }

    if (slotsPerWeek === 0) {
      setGenerateMessage({
        type: 'error',
        text: 'No functional timetable slots are configured for this course, so sessions cannot be auto-generated.',
      })
      return
    }

    const totalNew = weeks * slotsPerWeek
    const projectedTotal = existingCount + totalNew

    if (projectedTotal > selectedCourse.total_sessions) {
      const maxWeeks = Math.floor((selectedCourse.total_sessions - existingCount) / slotsPerWeek)
      setGenerateMessage({
        type: 'error',
        text:
          maxWeeks > 0
            ? `Generating ${weeks} more week(s) would create ${totalNew} sessions (${slotsPerWeek}/week), bringing the total to ${projectedTotal} — beyond the planned ${selectedCourse.total_sessions}. Try ${maxWeeks} week(s) or fewer.`
            : `This course's planned ${selectedCourse.total_sessions} sessions are already fully scheduled (currently at ${existingCount}). No more can be generated.`,
      })
      return
    }

    setGenerating(true)

    const latestDate =
      existingCount > 0
        ? sessions.reduce((max, s) => (s.session_date > max ? s.session_date : max), sessions[0].session_date)
        : getTodayISTDateString()

    const mostRecentSession =
      existingCount > 0
        ? sessions.reduce((latest, s) => (s.session_number > latest.session_number ? s : latest), sessions[0])
        : null

    const timingConfig = mostRecentSession?.timing_config ?? 'start'
    const midClassEnabled = mostRecentSession?.mid_class_enabled ?? false

    const occurrenceDates = []
    for (const day of slotDays) {
      const firstOccurrence = nextOccurrenceOfDay(latestDate, day)
      for (let w = 0; w < weeks; w++) {
        occurrenceDates.push(addDaysToDateString(firstOccurrence, w * 7))
      }
    }
    occurrenceDates.sort()

    const newRows = occurrenceDates.map((date, i) => ({
      course_id: selectedCourse.id,
      session_number: maxSessionNumber + 1 + i,
      session_date: date,
      status: 'not_started',
      timing_config: timingConfig,
      mid_class_enabled: midClassEnabled,
      qr_duration_seconds: null,
    }))

    const { data, error: insertError } = await supabase
      .from('sessions')
      .insert(newRows)
      .select('session_number, session_date, status, current_phase, timing_config, mid_class_enabled')

    setGenerating(false)

    if (insertError) {
      setGenerateMessage({ type: 'error', text: insertError.message })
      return
    }

    setSessions((prev) => [...prev, ...data].sort((a, b) => a.session_number - b.session_number))
    setGenerateMessage({
      type: 'success',
      text: `Created ${data.length} new session(s): #${maxSessionNumber + 1}–#${maxSessionNumber + data.length}.`,
    })
  }

  async function handleSaveDuration() {
    setSavingDuration(true)
    setSaveMessage(null)

    const { error: updateError } = await supabase
      .from('courses')
      .update({ default_qr_duration_seconds: Number(durationInput) })
      .eq('id', selectedCourse.id)

    setSavingDuration(false)

    if (updateError) {
      setSaveMessage({ type: 'error', text: updateError.message })
      return
    }

    setCourses((prev) =>
      prev.map((c) =>
        c.id === selectedCourse.id
          ? { ...c, default_qr_duration_seconds: Number(durationInput) }
          : c,
      ),
    )
    setSaveMessage({ type: 'success', text: 'Saved.' })
  }

  async function handleExportCourse() {
    setExportingCourse(true)
    setExportError('')

    const [enrollRes, sessionsRes] = await Promise.all([
      supabase.from('enrollments').select('students(pgp_id, name)').eq('course_id', selectedCourse.id),
      supabase
        .from('sessions')
        .select('id, session_number')
        .eq('course_id', selectedCourse.id)
        .order('session_number'),
    ])

    if (enrollRes.error) {
      setExportingCourse(false)
      setExportError(enrollRes.error.message)
      return
    }
    if (sessionsRes.error) {
      setExportingCourse(false)
      setExportError(sessionsRes.error.message)
      return
    }

    const courseStudents = (enrollRes.data ?? [])
      .map((e) => e.students)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
    const courseSessions = sessionsRes.data ?? []
    const sessionIds = courseSessions.map((s) => s.id)

    let attendedPairs = new Set()
    if (sessionIds.length > 0) {
      const { data: attendanceData, error: attendanceError } = await supabase
        .from('attendance_records')
        .select('student_pgp_id, session_id')
        .in('session_id', sessionIds)

      if (attendanceError) {
        setExportingCourse(false)
        setExportError(attendanceError.message)
        return
      }

      attendedPairs = new Set(attendanceData.map((r) => `${r.student_pgp_id}::${r.session_id}`))
    }

    setExportingCourse(false)

    const rows = [
      [
        'PGP ID',
        'Name',
        ...courseSessions.map((s) => `Session ${s.session_number}`),
        'Total Present / Total Sessions',
      ],
    ]

    for (const student of courseStudents) {
      let presentCount = 0
      const cells = courseSessions.map((s) => {
        const present = attendedPairs.has(`${student.pgp_id}::${s.id}`)
        if (present) presentCount += 1
        return present ? 'Present' : 'Absent'
      })
      rows.push([student.pgp_id, student.name, ...cells, `${presentCount} / ${courseSessions.length}`])
    }

    const filename = `${courseShortCode(selectedCourse.name)}_Full_Attendance_${getTodayISTDateString()}.csv`
    downloadCsv(filename, rowsToCsv(rows))
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
            <p className="text-sm font-medium text-maroon-600">Admin Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
              {selectedCourse.name}
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              {selectedCourse.professor_name} · {students.length} students ·{' '}
              {selectedCourse.total_sessions} sessions planned
            </p>
          </div>
          <UserMenu />
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
          {courses.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCourseId(c.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                c.id === selectedCourseId
                  ? 'bg-maroon-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportCourse}
            disabled={exportingCourse}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportingCourse ? 'Preparing CSV…' : 'Download Full Course Attendance (CSV)'}
          </button>
          {exportError && (
            <p role="alert" className="text-sm text-red-700">
              {exportError}
            </p>
          )}
        </div>
      </Card>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-base font-semibold text-gray-900">Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Default QR rotation duration for new sessions in <strong>{selectedCourse.name}</strong>.
          Professors can override this per session.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              className="w-28 rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
            />
            <span className="text-sm text-gray-500">seconds</span>
          </div>
          <button
            type="button"
            onClick={handleSaveDuration}
            disabled={savingDuration}
            className="rounded-lg bg-maroon-600 px-6 py-2.5 font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingDuration ? 'Saving…' : 'Save'}
          </button>
        </div>

        {saveMessage && (
          <p
            role="alert"
            className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ${
              saveMessage.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
            }`}
          >
            {saveMessage.text}
          </p>
        )}
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-base font-semibold text-gray-900">Generate Upcoming Sessions</h2>
        <p className="mt-1 text-sm text-gray-500">
          Session {maxSessionNumber} of {selectedCourse.total_sessions} planned
          {slotsPerWeek > 0 && (
            <>
              {' '}
              · {weeksSoFar} week{weeksSoFar === 1 ? '' : 's'} completed so far ({slotsPerWeek} class
              {slotsPerWeek === 1 ? '' : 'es'}/week)
            </>
          )}
        </p>

        {slotsPerWeek === 0 ? (
          <p className="mt-4 text-sm text-gray-400">
            No functional timetable slots are configured for this course.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="weeks-to-generate" className="text-sm font-medium text-gray-700">
                Weeks to generate
              </label>
              <input
                id="weeks-to-generate"
                type="number"
                min="1"
                value={weeksInput}
                onChange={(e) => setWeeksInput(e.target.value)}
                className="w-20 rounded-lg border border-gray-300 px-3.5 py-2.5 text-center text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerateSessions}
              disabled={generating}
              className="rounded-lg bg-maroon-600 px-6 py-2.5 font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? 'Generating…' : 'Generate Upcoming Sessions'}
            </button>
          </div>
        )}

        {generateMessage && (
          <p
            role="alert"
            className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ${
              generateMessage.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
            }`}
          >
            {generateMessage.text}
          </p>
        )}
      </div>

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
            Sessions {sessionsLoading ? '' : `(${sessions.length})`}
          </h2>
        </div>
        {sessionsLoading ? (
          <p className="px-6 py-4 text-sm text-gray-500">Loading…</p>
        ) : sessionsError ? (
          <p role="alert" className="px-6 py-4 text-sm text-red-700">
            {sessionsError}
          </p>
        ) : sessions.length === 0 ? (
          <p className="px-6 py-4 text-sm text-gray-400">No sessions scheduled yet.</p>
        ) : (
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
                    <td className="px-6 py-3 text-gray-600">{displaySessionDate(session)}</td>
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
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-10">{children}</div>
}
