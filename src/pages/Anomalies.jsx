import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'

function truncateFingerprint(fingerprint) {
  return fingerprint.length > 12 ? `${fingerprint.slice(0, 12)}…` : fingerprint
}

export default function Anomalies() {
  const [running, setRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [error, setError] = useState('')
  const [sharedDevices, setSharedDevices] = useState([])
  const [flaggedStudents, setFlaggedStudents] = useState([])

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

    setHasRun(true)
    setRunning(false)
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
