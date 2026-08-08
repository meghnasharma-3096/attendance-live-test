import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

function statusLabel(record) {
  if (!record) return 'Absent'
  if (record.method === 'manual_entry') return 'Manual Entry'
  if (record.method === 'qr_scan') return 'QR Marked'
  return record.method
}

function statusBadgeClass(record) {
  if (!record) return 'bg-gray-100 text-gray-600'
  if (record.method === 'manual_entry') return 'bg-amber-100 text-amber-800'
  return 'bg-green-100 text-green-800'
}

// Live, full-roster replacement for the plain headcount box. Read-only while a session is
// qr_live/manual_only (updates as real scans and Manual Override entries come in via its own
// Realtime subscription below); gains per-row checkboxes once the session is 'ended'.
export default function LiveRoster({ sessionId, courseId, phase, editable }) {
  const [students, setStudents] = useState([])
  const [attendanceByStudent, setAttendanceByStudent] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyPgpId, setBusyPgpId] = useState(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [rowError, setRowError] = useState('')

  useEffect(() => {
    async function loadRoster() {
      setLoading(true)
      setError('')

      const { data, error: enrollError } = await supabase
        .from('enrollments')
        .select('students(pgp_id, name)')
        .eq('course_id', courseId)

      if (enrollError) {
        setError(enrollError.message)
        setLoading(false)
        return
      }

      const list = (data ?? [])
        .map((e) => e.students)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name))

      setStudents(list)
      setLoading(false)
    }

    loadRoster()
  }, [courseId])

  async function refreshAttendance() {
    const { data, error: attendanceError } = await supabase
      .from('attendance_records')
      .select('id, student_pgp_id, method')
      .eq('session_id', sessionId)
      .eq('phase', phase)

    if (!attendanceError) {
      setAttendanceByStudent(new Map((data ?? []).map((r) => [r.student_pgp_id, { id: r.id, method: r.method }])))
    }
  }

  useEffect(() => {
    refreshAttendance()

    const channel = supabase
      .channel(`live-roster-${sessionId}-${phase}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${sessionId}` },
        () => refreshAttendance(),
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, phase])

  async function handleCheck(student) {
    setBusyPgpId(student.pgp_id)
    setRowError('')

    const { error: insertError } = await supabase.from('attendance_records').insert({
      session_id: sessionId,
      student_pgp_id: student.pgp_id,
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
      setRowError(insertError.message)
      setBusyPgpId(null)
      return
    }

    await refreshAttendance()
    setBusyPgpId(null)
  }

  // A QR-marked row being unchecked gets an audit entry in attendance_reversals *before* the
  // record is deleted — the whole point is a durable trail of "this was a real scan the
  // professor later removed," so it must be written first; if it failed after the delete,
  // the deletion would be silent and unrecoverable evidence-wise. A manual entry being
  // unchecked has no such trail: it was never real machine-verified attendance to begin with,
  // so reverting it is just undoing a correction, not overturning verified evidence.
  async function handleUncheck(student) {
    const record = attendanceByStudent.get(student.pgp_id)
    if (!record) return

    setBusyPgpId(student.pgp_id)
    setRowError('')

    if (record.method === 'qr_scan') {
      const { error: reversalError } = await supabase.from('attendance_reversals').insert({
        session_id: sessionId,
        student_pgp_id: student.pgp_id,
        original_method: record.method,
      })

      if (reversalError) {
        setRowError(reversalError.message)
        setBusyPgpId(null)
        return
      }
    }

    const { error: deleteError } = await supabase.rpc('delete_attendance_record', { p_id: record.id })

    if (deleteError) {
      setRowError(deleteError.message)
      setBusyPgpId(null)
      return
    }

    await refreshAttendance()
    setBusyPgpId(null)
  }

  async function handleMarkAllPresent() {
    setMarkingAll(true)
    setRowError('')

    const absentStudents = students.filter((s) => !attendanceByStudent.has(s.pgp_id))

    if (absentStudents.length > 0) {
      const { error: insertError } = await supabase.from('attendance_records').insert(
        absentStudents.map((s) => ({
          session_id: sessionId,
          student_pgp_id: s.pgp_id,
          method: 'manual_entry',
          device_fingerprint: null,
          gps_lat: null,
          gps_lng: null,
          gps_match: null,
          verification_tier: 'manual',
          flagged: false,
          flag_reason: null,
          phase,
        })),
      )

      if (insertError) {
        setRowError(insertError.message)
        setMarkingAll(false)
        return
      }
    }

    await refreshAttendance()
    setMarkingAll(false)
  }

  const presentCount = attendanceByStudent.size

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Live Roster</h2>
          <p className="mt-1 text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{presentCount}</span> /{' '}
            <span className="font-semibold text-gray-900">{students.length}</span> present
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={handleMarkAllPresent}
            disabled={markingAll || presentCount === students.length}
            className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {markingAll ? 'Marking…' : 'Mark All Present'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      {rowError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {rowError}
        </p>
      )}

      <div className="mt-4 max-h-[28rem] overflow-y-auto overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-2.5">PGP ID</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Status</th>
                {editable && <th className="px-4 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              {students.map((student, i) => {
                const record = attendanceByStudent.get(student.pgp_id)
                const isPresent = !!record
                const isBusy = busyPgpId === student.pgp_id

                return (
                  <tr key={student.pgp_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 text-gray-600">{student.pgp_id}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{student.name}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(record)}`}
                      >
                        {statusLabel(record)}
                      </span>
                    </td>
                    {editable && (
                      <td className="px-4 py-2.5 text-right">
                        <input
                          type="checkbox"
                          checked={isPresent}
                          disabled={isBusy}
                          onChange={() => (isPresent ? handleUncheck(student) : handleCheck(student))}
                          className="h-4 w-4 rounded border-gray-300 text-maroon-600 focus:ring-maroon-500 disabled:cursor-not-allowed"
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
