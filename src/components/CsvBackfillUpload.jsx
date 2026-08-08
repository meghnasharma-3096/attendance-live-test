import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { parseCsv } from '../lib/csv.js'

// Must match the session export's header exactly (Professor's "Download Attendance (CSV)" /
// Admin's course-wide export) — this feature is a round-trip: download, edit, re-upload.
const EXPECTED_HEADER = [
  'PGP ID',
  'Name',
  'Status',
  'Method',
  'Phase',
  'Marked At (IST)',
  'Verification Tier',
  'Flagged',
  'Flag Reason',
]

export default function CsvBackfillUpload({ sessionId, courseId, onUploaded }) {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file after fixing it
    if (!file) return

    setUploading(true)
    setError('')
    setResult(null)

    const text = await file.text()
    const rows = parseCsv(text)

    if (rows.length === 0) {
      setUploading(false)
      setError('The file is empty.')
      return
    }

    const header = rows[0].map((h) => h.trim())
    const headerMatches =
      header.length === EXPECTED_HEADER.length && EXPECTED_HEADER.every((col, i) => header[i] === col)

    if (!headerMatches) {
      setUploading(false)
      setError(
        `Column headers don't match the attendance export format. Expected: ${EXPECTED_HEADER.join(', ')}`,
      )
      return
    }

    const [enrollRes, existingRes] = await Promise.all([
      supabase.from('enrollments').select('student_pgp_id').eq('course_id', courseId),
      supabase.from('attendance_records').select('student_pgp_id, phase').eq('session_id', sessionId),
    ])

    if (enrollRes.error || existingRes.error) {
      setUploading(false)
      setError((enrollRes.error ?? existingRes.error).message)
      return
    }

    const enrolledSet = new Set((enrollRes.data ?? []).map((r) => r.student_pgp_id))
    const existingSet = new Set((existingRes.data ?? []).map((r) => `${r.student_pgp_id}::${r.phase ?? 'start'}`))

    const toInsert = []
    const skipped = []
    let alreadyRecorded = 0
    let absentRows = 0

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const line = i + 1

      if (row.length !== EXPECTED_HEADER.length) {
        skipped.push({ line, reason: `Expected ${EXPECTED_HEADER.length} columns, found ${row.length}` })
        continue
      }

      const pgpId = row[0].trim()
      const status = row[2].trim()
      const rawPhase = row[4].trim()

      if (!pgpId) {
        skipped.push({ line, reason: 'Missing PGP ID' })
        continue
      }
      if (!enrolledSet.has(pgpId)) {
        skipped.push({ line, reason: `${pgpId} is not enrolled in this course` })
        continue
      }
      if (status !== 'Present') {
        absentRows += 1
        continue
      }

      const phase = rawPhase === 'end' ? 'end' : 'start'
      const key = `${pgpId}::${phase}`

      if (existingSet.has(key)) {
        alreadyRecorded += 1
        continue
      }

      existingSet.add(key) // guard against the same student appearing twice in one file
      toInsert.push({
        session_id: sessionId,
        student_pgp_id: pgpId,
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
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from('attendance_records').insert(toInsert)
      if (insertError) {
        setUploading(false)
        setError(insertError.message)
        return
      }
    }

    setUploading(false)
    setResult({ inserted: toInsert.length, alreadyRecorded, absentRows, skipped })

    if (toInsert.length > 0) await onUploaded?.()
  }

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-base font-semibold text-gray-900">Upload Attendance CSV</h2>
      <p className="mt-1 text-sm text-gray-500">
        Same format as the attendance export — download it, mark students Present, and re-upload.
        Only Present rows with no existing record are added; everything else is left untouched.
      </p>

      <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50">
        {uploading ? 'Processing…' : 'Choose CSV File'}
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          disabled={uploading}
          className="hidden"
        />
      </label>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3.5 py-2.5 text-sm text-gray-700">
          <p>
            {result.inserted} record{result.inserted === 1 ? '' : 's'} added
            {result.alreadyRecorded > 0 && `, ${result.alreadyRecorded} already recorded (skipped)`}
            {result.absentRows > 0 && `, ${result.absentRows} absent row${result.absentRows === 1 ? '' : 's'} left unchanged`}
            .
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-700">
              {result.skipped.map((s, i) => (
                <li key={i}>
                  Line {s.line}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
