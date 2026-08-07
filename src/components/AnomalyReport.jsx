import { useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabaseClient.js'
import { formatDateTimeIST } from '../lib/dateFormat.js'
import { courseSectionSuffix, courseShortCode } from '../lib/csv.js'

function truncateFingerprint(fingerprint) {
  return fingerprint.length > 12 ? `${fingerprint.slice(0, 12)}…` : fingerprint
}

// "Overlap" is defined practically, since sessions don't store explicit start/end times —
// only attendance_records.marked_at is real evidence of when a session was actually live.
// Two same-day QR scans for the same student in different courses within this window are
// close enough that a real person could not physically have been in both classrooms.
const OVERLAP_WINDOW_MINUTES = 15

function istDateString(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function courseSectionLabel(courseName) {
  if (!courseName) return 'Unknown course'
  const suffix = courseSectionSuffix(courseName)
  return suffix ? `${courseShortCode(courseName)} ${suffix}` : courseShortCode(courseName)
}

// courseIds: string[] to restrict the check to those real courses, or null for no
// restriction (every course in the system — Admin's "All courses" view). An empty array
// (e.g. a subject like ITC with no real course rows) is handled without ever querying —
// there is nothing to find, so the result is "no anomalies" by construction, not a bug.
//
// showContext: whether every result row should carry its course/section/session alongside
// the student. Defaults to true whenever the scope spans anything other than exactly one
// course row, since that's the only case where the course is otherwise implied.
export default function AnomalyReport({ courses, courseIds, scopeLabel }) {
  const showContext = courseIds === null || courseIds.length !== 1

  const [running, setRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [error, setError] = useState('')
  const [sharedDevices, setSharedDevices] = useState([])
  const [flaggedStudents, setFlaggedStudents] = useState([])
  const [unverifiedMidClass, setUnverifiedMidClass] = useState([])
  const [pendingAppeals, setPendingAppeals] = useState([])
  const [appealResponseInputs, setAppealResponseInputs] = useState({})
  const [resolvingAppealId, setResolvingAppealId] = useState(null)
  const [appealActionError, setAppealActionError] = useState('')
  const [sameTimeAcrossCourses, setSameTimeAcrossCourses] = useState([])

  async function runCheck() {
    setRunning(true)
    setError('')

    if (courseIds !== null && courseIds.length === 0) {
      setSharedDevices([])
      setFlaggedStudents([])
      setUnverifiedMidClass([])
      setPendingAppeals([])
      setSameTimeAcrossCourses([])
      setHasRun(true)
      setRunning(false)
      return
    }

    // Shared device usage isn't tied to any course/session — device_history is purely
    // student + device. To scope it to a course selection, restrict to devices where at
    // least one student sharing that device is enrolled in one of the scoped courses, via a
    // separate enrollments lookup (also used to label each student's own course/section).
    const { data: history, error: historyError } = await fetchAllRows(() =>
      supabase.from('device_history').select('device_fingerprint, student_pgp_id').order('id'),
    )
    if (historyError) {
      setRunning(false)
      setError(historyError.message)
      return
    }

    const { data: enrollRows, error: enrollError } = await fetchAllRows(() =>
      supabase.from('enrollments').select('student_pgp_id, course_id').order('id'),
    )
    if (enrollError) {
      setRunning(false)
      setError(enrollError.message)
      return
    }

    const courseById = new Map(courses.map((c) => [c.id, c]))
    const coursesByStudent = new Map()
    for (const row of enrollRows ?? []) {
      if (!coursesByStudent.has(row.student_pgp_id)) coursesByStudent.set(row.student_pgp_id, [])
      coursesByStudent.get(row.student_pgp_id).push(row.course_id)
    }

    function studentCourseContext(pgpId) {
      const ids = coursesByStudent.get(pgpId) ?? []
      const inScope = courseIds === null ? ids : ids.filter((id) => courseIds.includes(id))
      return inScope
        .map((id) => courseById.get(id))
        .filter(Boolean)
        .map((c) => courseSectionLabel(c.name))
    }

    const byFingerprint = new Map()
    for (const row of history) {
      if (!byFingerprint.has(row.device_fingerprint)) {
        byFingerprint.set(row.device_fingerprint, new Set())
      }
      byFingerprint.get(row.device_fingerprint).add(row.student_pgp_id)
    }

    const sharedEntries = [...byFingerprint.entries()].filter(([, students]) => {
      if (students.size <= 1) return false
      if (courseIds === null) return true
      return [...students].some((pgpId) => (coursesByStudent.get(pgpId) ?? []).some((id) => courseIds.includes(id)))
    })
    const sharedPgpIds = sharedEntries.flatMap(([, students]) => [...students])

    const { data: flaggedRows, error: flaggedError } = await fetchAllRows(() => {
      let q = supabase
        .from('attendance_records')
        .select('student_pgp_id, flag_reason, marked_at, sessions!inner(course_id, session_number, courses(name))')
        .eq('flagged', true)
        .order('marked_at', { ascending: false })
      if (courseIds !== null) q = q.in('sessions.course_id', courseIds)
      return q
    })

    if (flaggedError) {
      setRunning(false)
      setError(flaggedError.message)
      return
    }

    const byStudent = new Map()
    for (const row of flaggedRows) {
      if (!byStudent.has(row.student_pgp_id)) {
        byStudent.set(row.student_pgp_id, {
          count: 0,
          mostRecentReason: row.flag_reason,
          mostRecentContext: row.sessions
            ? `${courseSectionLabel(row.sessions.courses?.name)} · S${row.sessions.session_number}`
            : null,
        })
      }
      byStudent.get(row.student_pgp_id).count += 1
    }

    const flaggedPgpIds = [...byStudent.keys()]
    const allPgpIds = [...new Set([...sharedPgpIds, ...flaggedPgpIds])]

    let nameByPgpId = new Map()
    if (allPgpIds.length > 0) {
      const { data: studentRows, error: studentsError } = await supabase
        .from('students')
        .select('pgp_id, name')
        .in('pgp_id', allPgpIds)

      if (studentsError) {
        setRunning(false)
        setError(studentsError.message)
        return
      }

      nameByPgpId = new Map(studentRows.map((s) => [s.pgp_id, s.name]))
    }

    setSharedDevices(
      sharedEntries.map(([fingerprint, students]) => ({
        fingerprint,
        students: [...students].map((pgpId) => ({
          pgpId,
          name: nameByPgpId.get(pgpId) ?? pgpId,
          context: studentCourseContext(pgpId),
        })),
      })),
    )

    setFlaggedStudents(
      flaggedPgpIds
        .map((pgpId) => ({
          pgpId,
          name: nameByPgpId.get(pgpId) ?? pgpId,
          count: byStudent.get(pgpId).count,
          mostRecentReason: byStudent.get(pgpId).mostRecentReason,
          context: byStudent.get(pgpId).mostRecentContext,
        }))
        .sort((a, b) => b.count - a.count),
    )

    const { data: unverifiedRows, error: unverifiedError } = await fetchAllRows(() => {
      let q = supabase
        .from('attendance_records')
        .select(
          'student_pgp_id, marked_at, students(name), sessions!inner(session_number, session_date, course_id, courses(name))',
        )
        .eq('mid_class_verified', false)
        .order('marked_at', { ascending: false })
      if (courseIds !== null) q = q.in('sessions.course_id', courseIds)
      return q
    })

    if (unverifiedError) {
      setRunning(false)
      setError(unverifiedError.message)
      return
    }

    setUnverifiedMidClass(
      (unverifiedRows ?? []).map((row) => ({
        pgpId: row.student_pgp_id,
        name: row.students?.name ?? row.student_pgp_id,
        sessionNumber: row.sessions?.session_number,
        markedAt: row.marked_at,
        context: row.sessions ? courseSectionLabel(row.sessions.courses?.name) : null,
      })),
    )

    const { data: appealRows, error: appealError } = await fetchAllRows(() => {
      let q = supabase
        .from('attendance_records')
        .select(
          'id, student_pgp_id, flag_reason, appeal_note, marked_at, students(name), sessions!inner(session_number, course_id, courses(name))',
        )
        .eq('appeal_status', 'pending')
        .order('marked_at', { ascending: false })
      if (courseIds !== null) q = q.in('sessions.course_id', courseIds)
      return q
    })

    if (appealError) {
      setRunning(false)
      setError(appealError.message)
      return
    }

    setPendingAppeals(
      (appealRows ?? []).map((row) => ({
        id: row.id,
        pgpId: row.student_pgp_id,
        name: row.students?.name ?? row.student_pgp_id,
        flagReason: row.flag_reason,
        appealNote: row.appeal_note,
        sessionNumber: row.sessions?.session_number,
        context: row.sessions ? courseSectionLabel(row.sessions.courses?.name) : null,
      })),
    )

    // Detecting a cross-course overlap requires the full, unrestricted picture — a scoped
    // course's own record is only half the story, and the other half may genuinely belong to
    // a course outside the scope. So this always fetches every qr_scan row, and only filters
    // the resulting PAIRS down to ones touching the scope afterward.
    const { data: qrRows, error: qrError } = await fetchAllRows(() =>
      supabase
        .from('attendance_records')
        .select('student_pgp_id, marked_at, students(name), sessions(session_number, course_id, courses(name))')
        .eq('method', 'qr_scan')
        .order('id'),
    )

    if (qrError) {
      setRunning(false)
      setError(qrError.message)
      return
    }

    const qrByStudent = new Map()
    for (const row of qrRows ?? []) {
      if (!row.sessions) continue
      const list = qrByStudent.get(row.student_pgp_id) ?? []
      list.push({
        name: row.students?.name ?? row.student_pgp_id,
        markedAt: row.marked_at,
        sessionNumber: row.sessions.session_number,
        courseId: row.sessions.course_id,
        courseName: row.sessions.courses?.name ?? 'Unknown course',
      })
      qrByStudent.set(row.student_pgp_id, list)
    }

    const windowMs = OVERLAP_WINDOW_MINUTES * 60 * 1000
    const overlaps = []

    for (const [pgpId, records] of qrByStudent.entries()) {
      for (let i = 0; i < records.length; i++) {
        for (let j = i + 1; j < records.length; j++) {
          const a = records[i]
          const b = records[j]
          if (a.courseId === b.courseId) continue

          const diffMs = Math.abs(new Date(a.markedAt).getTime() - new Date(b.markedAt).getTime())
          if (diffMs > windowMs) continue
          if (istDateString(a.markedAt) !== istDateString(b.markedAt)) continue
          if (courseIds !== null && !courseIds.includes(a.courseId) && !courseIds.includes(b.courseId)) continue

          overlaps.push({
            pgpId,
            name: a.name,
            gapMinutes: Math.round(diffMs / 60000),
            a,
            b,
          })
        }
      }
    }

    overlaps.sort((x, y) => x.gapMinutes - y.gapMinutes)
    setSameTimeAcrossCourses(overlaps)

    setHasRun(true)
    setRunning(false)
  }

  async function handleResolveAppeal(record, decision) {
    setResolvingAppealId(record.id)
    setAppealActionError('')

    const response = (appealResponseInputs[record.id] ?? '').trim()

    const { error: resolveError } = await supabase
      .from('attendance_records')
      .update({
        appeal_status: decision,
        professor_response: response || null,
        ...(decision === 'approved' ? { flagged: false } : {}),
      })
      .eq('id', record.id)

    setResolvingAppealId(null)

    if (resolveError) {
      setAppealActionError(resolveError.message)
      return
    }

    setPendingAppeals((prev) => prev.filter((a) => a.id !== record.id))
  }

  return (
    <div className="mt-6 rounded-xl bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Anomaly Detection</h2>
          <p className="mt-1 text-sm text-gray-500">
            On-demand check across all sessions recorded so far — not automatic or real-time.
            Scope: <span className="font-medium text-gray-700">{scopeLabel}</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={running}
          className="shrink-0 rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? 'Running check…' : 'Run Anomaly Check'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {hasRun && (
        <>
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">Shared Device Usage</h3>
            {sharedDevices.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-3 space-y-3">
                {sharedDevices.map((device) => (
                  <div
                    key={device.fingerprint}
                    className="rounded-xl border-l-4 border-red-400 bg-red-50 p-5 shadow-sm"
                  >
                    <p className="font-mono text-sm text-red-800">{truncateFingerprint(device.fingerprint)}</p>
                    <p className="mt-1 text-sm text-red-700">
                      These students have marked attendance using the exact same device — possible
                      proxy attendance.
                    </p>
                    <ul className="mt-3 space-y-1">
                      {device.students.map((s) => (
                        <li key={s.pgpId} className="text-sm">
                          <span className="font-medium text-gray-900">{s.name}</span>
                          <span className="ml-2 text-gray-500">{s.pgpId}</span>
                          {showContext && s.context.length > 0 && (
                            <span className="ml-2 text-gray-500">· {s.context.join(', ')}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">GPS/Verification Flags</h3>
            {flaggedStudents.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border-l-4 border-amber-400 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                        <th className="px-6 py-3">Student</th>
                        <th className="px-6 py-3">PGP ID</th>
                        {showContext && <th className="px-6 py-3">Most Recent In</th>}
                        <th className="px-6 py-3">Flagged</th>
                        <th className="px-6 py-3">Most Recent Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flaggedStudents.map((s, i) => (
                        <tr key={s.pgpId} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/40'}>
                          <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                          <td className="px-6 py-3 text-gray-600">{s.pgpId}</td>
                          {showContext && <td className="px-6 py-3 text-gray-600">{s.context ?? '—'}</td>}
                          <td className="px-6 py-3">
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                              {s.count}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-gray-600">{s.mostRecentReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">Pending Flag Appeals</h3>
            {appealActionError && (
              <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {appealActionError}
              </p>
            )}
            {pendingAppeals.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-3 space-y-3">
                {pendingAppeals.map((appeal) => (
                  <div key={appeal.id} className="rounded-xl border-l-4 border-maroon-400 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-gray-900">{appeal.name}</p>
                        <p className="text-xs text-gray-500">
                          {appeal.pgpId}
                          {showContext && appeal.context && ` · ${appeal.context}`}
                          {showContext && appeal.sessionNumber != null && ` · S${appeal.sessionNumber}`}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Flag reason:</span> {appeal.flagReason}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Student's note:</span> {appeal.appealNote}
                    </p>

                    <input
                      type="text"
                      value={appealResponseInputs[appeal.id] ?? ''}
                      onChange={(e) =>
                        setAppealResponseInputs((prev) => ({ ...prev, [appeal.id]: e.target.value }))
                      }
                      placeholder="Optional response to the student"
                      className="mt-3 w-full rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
                    />

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleResolveAppeal(appeal, 'approved')}
                        disabled={resolvingAppealId === appeal.id}
                        className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resolvingAppealId === appeal.id ? 'Saving…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveAppeal(appeal, 'denied')}
                        disabled={resolvingAppealId === appeal.id}
                        className="rounded-lg border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resolvingAppealId === appeal.id ? 'Saving…' : 'Deny'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">Present but Unverified Mid-Class</h3>
            {unverifiedMidClass.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border-l-4 border-orange-400 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                        <th className="px-6 py-3">Student</th>
                        <th className="px-6 py-3">PGP ID</th>
                        {showContext && <th className="px-6 py-3">Course</th>}
                        <th className="px-6 py-3">Session</th>
                        <th className="px-6 py-3">Marked Present At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unverifiedMidClass.map((row, i) => (
                        <tr
                          key={`${row.pgpId}-${row.sessionNumber}`}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-orange-50/40'}
                        >
                          <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                          <td className="px-6 py-3 text-gray-600">{row.pgpId}</td>
                          {showContext && <td className="px-6 py-3 text-gray-600">{row.context ?? '—'}</td>}
                          <td className="px-6 py-3 text-gray-600">
                            {row.sessionNumber != null ? `Session ${row.sessionNumber}` : '—'}
                          </td>
                          <td className="px-6 py-3 text-gray-600">
                            {row.markedAt ? formatDateTimeIST(row.markedAt) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-400">
              Marked present at the start of a session but did not respond to that session's random
              mid-class re-verification check — a likely "scan and leave" pattern.
            </p>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900">Same-Time Attendance Across Courses</h3>
            {sameTimeAcrossCourses.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border-l-4 border-red-400 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                        <th className="px-6 py-3">Student</th>
                        <th className="px-6 py-3">PGP ID</th>
                        <th className="px-6 py-3">Course / Session A</th>
                        <th className="px-6 py-3">Time A</th>
                        <th className="px-6 py-3">Course / Session B</th>
                        <th className="px-6 py-3">Time B</th>
                        <th className="px-6 py-3">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sameTimeAcrossCourses.map((row, i) => (
                        <tr
                          key={`${row.pgpId}-${row.a.markedAt}-${row.b.markedAt}`}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-red-50/40'}
                        >
                          <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                          <td className="px-6 py-3 text-gray-600">{row.pgpId}</td>
                          <td className="px-6 py-3 text-gray-600">
                            {courseSectionLabel(row.a.courseName)} · S{row.a.sessionNumber}
                          </td>
                          <td className="px-6 py-3 text-gray-600">{formatDateTimeIST(row.a.markedAt)}</td>
                          <td className="px-6 py-3 text-gray-600">
                            {courseSectionLabel(row.b.courseName)} · S{row.b.sessionNumber}
                          </td>
                          <td className="px-6 py-3 text-gray-600">{formatDateTimeIST(row.b.markedAt)}</td>
                          <td className="px-6 py-3">
                            <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                              {row.gapMinutes} min
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-400">
              Marked present via QR scan in two different courses on the same day within{' '}
              {OVERLAP_WINDOW_MINUTES} minutes — a real person cannot physically be in two classrooms at
              once. Manual entries are excluded, since they aren't device/location-verified anyway.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-3 rounded-xl bg-white p-6 text-center shadow-sm">
      <p className="text-gray-500">No anomalies detected.</p>
    </div>
  )
}
