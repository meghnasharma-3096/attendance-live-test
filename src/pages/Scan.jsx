import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FingerprintJS from '@fingerprintjs/fingerprintjs'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

const GPS_MATCH_RADIUS_METERS = 100

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

export default function Scan() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [phase, setPhase] = useState('loading')
  const [message, setMessage] = useState('')
  const [sessionNumber, setSessionNumber] = useState(null)

  const sessionId = searchParams.get('session')
  const token = searchParams.get('token')
  const attendancePhase = searchParams.get('phase') || 'start'

  useEffect(() => {
    if (!user) return

    async function run() {
      if (!sessionId || !token) {
        setPhase('error')
        setMessage('This QR link is missing required information.')
        return
      }

      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('id, session_number, current_token, reference_lat, reference_lng, status')
        .eq('id', sessionId)
        .maybeSingle()

      if (sessionError || !session) {
        setPhase('error')
        setMessage(sessionError?.message ?? 'Session not found.')
        return
      }

      setSessionNumber(session.session_number)

      if (session.status !== 'qr_live') {
        setPhase('closed')
        setMessage('Attendance is closed for this session.')
        return
      }

      if (token !== session.current_token) {
        setPhase('expired')
        setMessage('This QR code has expired — scan the current one on screen.')
        return
      }

      const { data: existingRecord, error: existingError } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('session_id', session.id)
        .eq('student_pgp_id', user.student_pgp_id)
        .eq('phase', attendancePhase)
        .maybeSingle()

      if (existingError) {
        setPhase('error')
        setMessage(existingError.message)
        return
      }

      if (existingRecord) {
        setPhase('already-marked')
        setMessage("You're already marked present for this session.")
        return
      }

      setPhase('processing')

      const fp = await FingerprintJS.load()
      const { visitorId: deviceFingerprint } = await fp.get()

      let gpsLat = null
      let gpsLng = null
      let gpsMatch = false
      try {
        const position = await getCurrentPosition()
        gpsLat = position.coords.latitude
        gpsLng = position.coords.longitude
        const distance = haversineDistanceMeters(
          gpsLat,
          gpsLng,
          session.reference_lat,
          session.reference_lng,
        )
        gpsMatch = distance < GPS_MATCH_RADIUS_METERS
      } catch {
        gpsMatch = false
      }

      const { error: lockError } = await supabase.from('device_locks').insert({
        session_id: session.id,
        device_fingerprint: deviceFingerprint,
        student_pgp_id: user.student_pgp_id,
        phase: attendancePhase,
      })

      if (lockError) {
        if (lockError.code === '23505') {
          setPhase('device-used')
          setMessage('This device has already been used to mark attendance for this session.')
          return
        }
        setPhase('error')
        setMessage(lockError.message)
        return
      }

      const { error: insertError } = await supabase.from('attendance_records').insert({
        session_id: session.id,
        student_pgp_id: user.student_pgp_id,
        method: 'qr_scan',
        device_fingerprint: deviceFingerprint,
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        gps_match: gpsMatch,
        verification_tier: 'phone_gps',
        flagged: !gpsMatch,
        flag_reason: gpsMatch ? null : 'GPS location did not match classroom',
        phase: attendancePhase,
      })

      if (insertError) {
        setPhase('error')
        setMessage(insertError.message)
        return
      }

      setPhase('success')
    }

    run()
  }, [user, sessionId, token, attendancePhase])

  return (
    <PageShell>
      <Card>
        <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-maroon-600" />

        {(phase === 'loading' || phase === 'processing') && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-maroon-600" />
            <p className="text-gray-500">
              {phase === 'loading' ? 'Checking session…' : 'Marking you present…'}
            </p>
          </div>
        )}

        {phase === 'expired' && <StatusBlock tone="warning" title="QR code expired" message={message} />}
        {phase === 'closed' && <StatusBlock tone="warning" title="Attendance closed" message={message} />}
        {phase === 'device-used' && (
          <StatusBlock tone="error" title="Device already used" message={message} />
        )}
        {phase === 'error' && <StatusBlock tone="error" title="Something went wrong" message={message} />}
        {phase === 'already-marked' && (
          <StatusBlock tone="neutral" title="Already marked" message={message} />
        )}

        {phase === 'success' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 text-5xl text-green-700">
              ✓
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              You're marked present for Session {sessionNumber}
            </h1>
            <p className="text-gray-500">{user.name}</p>
          </div>
        )}
      </Card>
    </PageShell>
  )
}

function StatusBlock({ tone, title, message }) {
  const toneClasses = {
    warning: 'bg-amber-50 text-amber-700',
    error: 'bg-red-50 text-red-700',
    neutral: 'bg-gray-50 text-gray-700',
  }

  return (
    <div className={`rounded-lg px-4 py-8 text-center ${toneClasses[tone]}`}>
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  )
}

function PageShell({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

function Card({ children }) {
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-8">{children}</div>
}
