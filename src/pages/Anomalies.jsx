import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { formatDateTimeIST } from '../lib/dateFormat.js'

function truncateFingerprint(fingerprint) {
  return fingerprint.length > 12 ? `${fingerprint.slice(0, 12)}…` : fingerprint
}

export default function Anomalies() {
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

  async function runCheck() {
    setRunning(true)
    setError('')

    const { data: history, error: historyError } = await supabase
      .from('device_history')
      .select('device_fingerprint, student_pgp_id')

    if (historyError) {
      setRunning(false)
      setError(historyError.message)
      return
    }

    const byFingerprint = new Map()
    for (const row of history) {
      if (!byFingerprint.has(row.device_fingerprint)) {
        byFingerprint.set(row.device_fingerprint, new Set())
      }
      byFingerprint.get(row.device_fingerprint).add(row.student_pgp_id)
    }

    const sharedEntries = [...byFingerprint.entries()].filter(([, students]) => students.size > 1)
    const sharedPgpIds = sharedEntries.flatMap(([, students]) => [...students])

    const { data: flaggedRows, error: flaggedError } = await supabase
      .from('attendance_records')
      .select('student_pgp_id, flag_reason, marked_at')
      .eq('flagged', true)
      .order('marked_at', { ascending: false })

    if (flaggedError) {
      setRunning(false)
      setError(flaggedError.message)
      return
    }

    const byStudent = new Map()
    for (const row of flaggedRows) {
      if (!byStudent.has(row.student_pgp_id)) {
        byStudent.set(row.student_pgp_id, { count: 0, mostRecentReason: row.flag_reason })
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
        }))
        .sort((a, b) => b.count - a.count),
    )

    const { data: unverifiedRows, error: unverifiedError } = await supabase
      .from('attendance_records')
      .select('student_pgp_id, marked_at, students(name), sessions(session_number, session_date)')
      .eq('mid_class_verified', false)
      .order('marked_at', { ascending: false })

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
      })),
    )

    const { data: appealRows, error: appealError } = await supabase
      .from('attendance_records')
      .select(
        'id, student_pgp_id, flag_reason, appeal_note, marked_at, students(name), sessions(session_number, courses(name))',
      )
      .eq('appeal_status', 'pending')
      .order('marked_at', { ascending: false })

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
        courseName: row.sessions?.courses?.name,
        sessionNumber: row.sessions?.session_number,
      })),
    )

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
    <PageShell>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-maroon-600">Professor Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
              Anomaly Detection
            </h1>
          </div>
          <Link
            to="/professor"
            className="mt-1 shrink-0 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            ← Back
          </Link>
        </div>

        <p className="mt-2 text-sm text-gray-500">
          On-demand check across all sessions recorded so far — not automatic or real-time.
        </p>

        <button
          type="button"
          onClick={runCheck}
          disabled={running}
          className="mt-6 rounded-lg bg-maroon-600 px-6 py-2.5 font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? 'Running check…' : 'Run Anomaly Check'}
        </button>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
      </Card>

      {hasRun && (
        <>
          <div className="mt-6">
            <h2 className="text-base font-semibold text-gray-900">Shared Device Usage</h2>
            {sharedDevices.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-3 space-y-3">
                {sharedDevices.map((device) => (
                  <div
                    key={device.fingerprint}
                    className="rounded-xl border-l-4 border-red-400 bg-red-50 p-5 shadow-sm"
                  >
                    <p className="font-mono text-sm text-red-800">
                      {truncateFingerprint(device.fingerprint)}
                    </p>
                    <p className="mt-1 text-sm text-red-700">
                      These students have marked attendance using the exact same device — possible
                      proxy attendance.
                    </p>
                    <ul className="mt-3 space-y-1">
                      {device.students.map((s) => (
                        <li key={s.pgpId} className="text-sm">
                          <span className="font-medium text-gray-900">{s.name}</span>
                          <span className="ml-2 text-gray-500">{s.pgpId}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <h2 className="text-base font-semibold text-gray-900">GPS/Verification Flags</h2>
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
                        <th className="px-6 py-3">Flagged</th>
                        <th className="px-6 py-3">Most Recent Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flaggedStudents.map((s, i) => (
                        <tr key={s.pgpId} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/40'}>
                          <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                          <td className="px-6 py-3 text-gray-600">{s.pgpId}</td>
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
            <h2 className="text-base font-semibold text-gray-900">Pending Flag Appeals</h2>
            <p className="mt-1 text-xs text-gray-400">
              Across all courses — this account is a single demo professor login with visibility into
              every seeded course (see ARCHITECTURE_NOTES.md).
            </p>
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
                  <div
                    key={appeal.id}
                    className="rounded-xl border-l-4 border-maroon-400 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-gray-900">{appeal.name}</p>
                        <p className="text-xs text-gray-500">
                          {appeal.pgpId}
                          {appeal.courseName && ` · ${appeal.courseName}`}
                          {appeal.sessionNumber != null && ` · Session ${appeal.sessionNumber}`}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Flag reason:</span>{' '}
                      {appeal.flagReason}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Student's note:</span>{' '}
                      {appeal.appealNote}
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
            <h2 className="text-base font-semibold text-gray-900">Present but Unverified Mid-Class</h2>
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
        </>
      )}
    </PageShell>
  )
}

function EmptyState() {
  return (
    <div className="mt-3 rounded-xl bg-white p-6 text-center shadow-sm">
      <p className="text-gray-500">No anomalies detected.</p>
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
  return <div className="rounded-xl bg-white p-6 shadow-sm sm:p-10">{children}</div>
}
