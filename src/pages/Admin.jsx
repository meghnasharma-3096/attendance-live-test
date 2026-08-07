import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import {
  addDaysToDateString,
  formatDateIST,
  formatTimeRange,
  getTodayISTDateString,
  nextOccurrenceOfDay,
} from '../lib/dateFormat.js'
import { courseShortCode, downloadCsv, rowsToCsv } from '../lib/csv.js'
import UserMenu from '../components/UserMenu.jsx'

const DISTRIBUTION_BAND_COLORS = {
  '90-100%': '#22c55e',
  '75-89%': '#f59e0b',
  '50-74%': '#f97316',
  'Below 50%': '#ef4444',
}
const METHOD_COLORS = { 'QR Scan': '#7a1e2b', 'Manual Entry': '#f59e0b' }

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_STYLES = {
  not_started: 'bg-gray-100 text-gray-600',
  qr_live: 'bg-green-100 text-green-700',
  awaiting_end: 'bg-amber-50 text-amber-700',
  manual_only: 'bg-orange-50 text-orange-700',
  ended: 'bg-blue-50 text-blue-700',
  cancelled: 'bg-gray-100 text-gray-400',
}

function statusLabel(status) {
  if (status === 'not_started') return 'Not started'
  if (status === 'qr_live') return 'Live now'
  if (status === 'awaiting_end') return 'Awaiting end-of-class'
  if (status === 'manual_only') return 'Manual mode'
  if (status === 'ended') return 'Ended'
  if (status === 'cancelled') return 'Cancelled'
  return status
}

function displaySessionDate(session) {
  const todayString = getTodayISTDateString()
  const neverGoneLive =
    session.status === 'not_started' || (session.status === 'awaiting_end' && !session.current_phase)
  const isStale = neverGoneLive && session.session_date < todayString
  return formatDateIST(isStale ? todayString : session.session_date)
}

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd)
}

function emptySlotForm() {
  return { day_of_week: 'Mon', start_time: '10:30', end_time: '12:00', section: '', room: '', is_functional: false }
}

function emptyCourseForm() {
  return { name: '', professor_name: '', total_sessions: '20', default_qr_duration_seconds: '60' }
}

function rescheduleFormFromSession(session) {
  return {
    session_date: session.session_date,
    start_time: session.start_time ? session.start_time.slice(0, 5) : '',
    end_time: session.end_time ? session.end_time.slice(0, 5) : '',
    room: session.room ?? '',
  }
}

export default function Admin() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState([])
  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [studentsError, setStudentsError] = useState('')
  const [allStudents, setAllStudents] = useState([])
  const [selectedCourseId, setSelectedCourseId] = useState(null)

  const [manageEnrollmentOpen, setManageEnrollmentOpen] = useState(false)
  const [enrollSearchText, setEnrollSearchText] = useState('')
  const [enrollingPgpId, setEnrollingPgpId] = useState(null)
  const [removingPgpId, setRemovingPgpId] = useState(null)
  const [enrollmentMessage, setEnrollmentMessage] = useState(null)

  const [courseFormOpen, setCourseFormOpen] = useState(false)
  const [courseForm, setCourseForm] = useState(emptyCourseForm())
  const [savingCourse, setSavingCourse] = useState(false)
  const [courseFormError, setCourseFormError] = useState('')

  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [sessions, setSessions] = useState([])

  const [durationInput, setDurationInput] = useState('')
  const [savingDuration, setSavingDuration] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  const [exportingCourse, setExportingCourse] = useState(false)
  const [exportError, setExportError] = useState('')

  const [timetableSlots, setTimetableSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [slotsError, setSlotsError] = useState('')
  const [timetableMessage, setTimetableMessage] = useState(null)

  const [slotFormOpen, setSlotFormOpen] = useState(false)
  const [editingSlotId, setEditingSlotId] = useState(null)
  const [slotForm, setSlotForm] = useState(emptySlotForm())
  const [savingSlot, setSavingSlot] = useState(false)
  const [slotFormError, setSlotFormError] = useState('')

  const [weeksInput, setWeeksInput] = useState('4')
  const [generating, setGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState(null)

  const [cancellingSessionNumber, setCancellingSessionNumber] = useState(null)
  const [cancelReasonInput, setCancelReasonInput] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const [reschedulingSessionNumber, setReschedulingSessionNumber] = useState(null)
  const [rescheduleForm, setRescheduleForm] = useState(null)
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState('')

  const [markingOfflineSessionNumber, setMarkingOfflineSessionNumber] = useState(null)

  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState('')
  const [attendanceOverTime, setAttendanceOverTime] = useState([])
  const [distributionData, setDistributionData] = useState([])
  const [methodBreakdown, setMethodBreakdown] = useState([])

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  useEffect(() => {
    if (!user) return

    async function loadData() {
      setLoading(true)
      setError('')

      const [coursesRes, allStudentsRes] = await Promise.all([
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
      if (allStudentsRes.error) {
        setError(allStudentsRes.error.message)
        setLoading(false)
        return
      }

      setCourses(coursesRes.data)
      setAllStudents(allStudentsRes.data ?? [])
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
    setTimetableMessage(null)
    setSlotFormOpen(false)
    setEditingSlotId(null)
    setCourseFormOpen(false)
    setCourseFormError('')
    setManageEnrollmentOpen(false)
    setEnrollSearchText('')
    setEnrollmentMessage(null)
    setCancellingSessionNumber(null)
    setCancelReasonInput('')
    setCancelError('')
    setReschedulingSessionNumber(null)
    setRescheduleForm(null)
    setRescheduleError('')
    setMarkingOfflineSessionNumber(null)

    async function loadSessions() {
      setSessionsLoading(true)
      setSessionsError('')

      const { data, error: sessionsErr } = await supabase
        .from('sessions')
        .select(
          'id, session_number, session_date, start_time, end_time, room, status, current_phase, timing_config, mid_class_enabled, cancellation_reason',
        )
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

    loadSessions()
    loadTimetableSlots(selectedCourse)
    loadEnrolledStudents(selectedCourse)
    loadAnalytics(selectedCourse)
  }, [selectedCourse?.id])

  async function loadAnalytics(course) {
    setAnalyticsLoading(true)
    setAnalyticsError('')

    const [sessionsRes, enrollRes] = await Promise.all([
      supabase.from('sessions').select('id, session_number, status').eq('course_id', course.id).order('session_number'),
      supabase.from('enrollments').select('student_pgp_id').eq('course_id', course.id),
    ])

    if (sessionsRes.error) {
      setAnalyticsError(sessionsRes.error.message)
      setAnalyticsLoading(false)
      return
    }
    if (enrollRes.error) {
      setAnalyticsError(enrollRes.error.message)
      setAnalyticsLoading(false)
      return
    }

    // Same "conducted" definition used for the attendance-percentage fix elsewhere:
    // not_started and cancelled sessions never happened, so they can't have an attendance rate.
    const conductedSessions = (sessionsRes.data ?? []).filter(
      (s) => s.status !== 'not_started' && s.status !== 'cancelled',
    )
    const enrolledPgpIds = (enrollRes.data ?? []).map((e) => e.student_pgp_id)
    const enrolledSet = new Set(enrolledPgpIds)
    const sessionIds = conductedSessions.map((s) => s.id)

    let attendanceRows = []
    if (sessionIds.length > 0) {
      const { data, error: attendanceErr } = await supabase
        .from('attendance_records')
        .select('student_pgp_id, session_id, method')
        .in('session_id', sessionIds)

      if (attendanceErr) {
        setAnalyticsError(attendanceErr.message)
        setAnalyticsLoading(false)
        return
      }
      // Scope to currently-enrolled students only, so a student later removed from the
      // roster doesn't leave phantom data skewing these course-level charts.
      attendanceRows = (data ?? []).filter((r) => enrolledSet.has(r.student_pgp_id))
    }

    const countBySession = new Map()
    for (const row of attendanceRows) {
      countBySession.set(row.session_id, (countBySession.get(row.session_id) ?? 0) + 1)
    }
    const enrolledCount = enrolledPgpIds.length
    setAttendanceOverTime(
      conductedSessions.map((s) => ({
        session: `S${s.session_number}`,
        rate:
          enrolledCount > 0
            ? Math.round(((countBySession.get(s.id) ?? 0) / enrolledCount) * 1000) / 10
            : 0,
      })),
    )

    const presentCountByStudent = new Map()
    for (const row of attendanceRows) {
      presentCountByStudent.set(row.student_pgp_id, (presentCountByStudent.get(row.student_pgp_id) ?? 0) + 1)
    }
    const totalConducted = conductedSessions.length
    const bands = { '90-100%': 0, '75-89%': 0, '50-74%': 0, 'Below 50%': 0 }
    for (const pgpId of enrolledPgpIds) {
      const pct = totalConducted > 0 ? ((presentCountByStudent.get(pgpId) ?? 0) / totalConducted) * 100 : 0
      if (pct >= 90) bands['90-100%'] += 1
      else if (pct >= 75) bands['75-89%'] += 1
      else if (pct >= 50) bands['50-74%'] += 1
      else bands['Below 50%'] += 1
    }
    setDistributionData(Object.entries(bands).map(([band, count]) => ({ band, count })))

    let qrCount = 0
    let manualCount = 0
    for (const row of attendanceRows) {
      if (row.method === 'qr_scan') qrCount += 1
      else if (row.method === 'manual_entry') manualCount += 1
    }
    setMethodBreakdown(
      [
        { name: 'QR Scan', value: qrCount },
        { name: 'Manual Entry', value: manualCount },
      ].filter((d) => d.value > 0),
    )

    setAnalyticsLoading(false)
  }

  function handleOpenCancelForm(session) {
    setCancellingSessionNumber(session.session_number)
    setCancelReasonInput('')
    setCancelError('')
  }

  function handleCloseCancelForm() {
    setCancellingSessionNumber(null)
    setCancelReasonInput('')
    setCancelError('')
  }

  // Cancelling only flips status (and records why) — it never deletes the row, so the
  // session_number stays permanently reserved and historical numbering never shifts.
  async function handleConfirmCancelSession(session) {
    setCancelError('')
    setCancelling(true)

    const { data, error: cancelErr } = await supabase
      .from('sessions')
      .update({ status: 'cancelled', cancellation_reason: cancelReasonInput.trim() || null })
      .eq('id', session.id)
      .select(
        'id, session_number, session_date, start_time, end_time, room, status, current_phase, timing_config, mid_class_enabled, cancellation_reason',
      )
      .single()

    setCancelling(false)

    if (cancelErr) {
      setCancelError(cancelErr.message)
      return
    }

    setSessions((prev) => prev.map((s) => (s.id === data.id ? data : s)))
    handleCloseCancelForm()
  }

  function handleOpenRescheduleForm(session) {
    setReschedulingSessionNumber(session.session_number)
    setRescheduleForm(rescheduleFormFromSession(session))
    setRescheduleError('')
  }

  function handleCloseRescheduleForm() {
    setReschedulingSessionNumber(null)
    setRescheduleForm(null)
    setRescheduleError('')
  }

  // A genuine override: once saved, this session's date/time/room live directly on its own
  // row, fully decoupled from the timetable_slot it was originally generated from. Re-running
  // "Generate Upcoming Sessions" never touches existing rows, so this can't be clobbered later.
  // Rescheduling a previously-cancelled session (e.g. a holiday class moved to a makeup slot)
  // deliberately brings it back to 'not_started' and clears the cancellation reason — there's
  // still no generic "un-cancel" button, only this one purposeful path back to life.
  async function handleSaveReschedule(session) {
    setRescheduleError('')

    const { session_date, start_time, end_time, room } = rescheduleForm

    if (!session_date) {
      setRescheduleError('Date is required.')
      return
    }
    if ((start_time && !end_time) || (!start_time && end_time)) {
      setRescheduleError('Enter both a start and end time, or leave both blank.')
      return
    }
    if (start_time && end_time && start_time >= end_time) {
      setRescheduleError('End time must be after start time.')
      return
    }

    setRescheduling(true)

    const { data, error: rescheduleErr } = await supabase
      .from('sessions')
      .update({
        session_date,
        start_time: start_time ? `${start_time}:00` : null,
        end_time: end_time ? `${end_time}:00` : null,
        room: room.trim() || null,
        status: 'not_started',
        cancellation_reason: null,
      })
      .eq('id', session.id)
      .select(
        'id, session_number, session_date, start_time, end_time, room, status, current_phase, timing_config, mid_class_enabled, cancellation_reason',
      )
      .single()

    setRescheduling(false)

    if (rescheduleErr) {
      setRescheduleError(rescheduleErr.message)
      return
    }

    setSessions((prev) => prev.map((s) => (s.id === data.id ? data : s)))
    handleCloseRescheduleForm()
  }

  // Skips the normal geolocation-gated Start Session flow entirely — this is for a class that
  // already happened without live attendance being taken. Setting status straight to
  // 'manual_only' unlocks Manual Override on that session's own Live page immediately, without
  // touching any other session's row, so the next session in sequence stays fully startable.
  async function handleMarkOffline(session) {
    const confirmed = window.confirm(
      `Mark Session ${session.session_number} as offline? This skips the QR/GPS flow entirely — attendance for it can only be backfilled via Manual Override afterward.`,
    )
    if (!confirmed) return

    setMarkingOfflineSessionNumber(session.session_number)

    const { data, error: markErr } = await supabase
      .from('sessions')
      .update({ status: 'manual_only' })
      .eq('id', session.id)
      .select(
        'id, session_number, session_date, start_time, end_time, room, status, current_phase, timing_config, mid_class_enabled, cancellation_reason',
      )
      .single()

    setMarkingOfflineSessionNumber(null)

    if (markErr) {
      setSessionsError(markErr.message)
      return
    }

    setSessions((prev) => prev.map((s) => (s.id === data.id ? data : s)))
  }

  async function loadEnrolledStudents(course) {
    setStudentsLoading(true)
    setStudentsError('')

    const { data, error: enrollError } = await supabase
      .from('enrollments')
      .select('students(pgp_id, name)')
      .eq('course_id', course.id)

    if (enrollError) {
      setStudentsError(enrollError.message)
      setStudentsLoading(false)
      return
    }

    const enrolled = (data ?? [])
      .map((e) => e.students)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))

    setStudents(enrolled)
    setStudentsLoading(false)
  }

  async function handleEnrollStudent(student) {
    setEnrollingPgpId(student.pgp_id)
    setEnrollmentMessage(null)

    const { error: insertError } = await supabase
      .from('enrollments')
      .insert({ course_id: selectedCourse.id, student_pgp_id: student.pgp_id })

    setEnrollingPgpId(null)

    if (insertError) {
      setEnrollmentMessage({ type: 'error', text: insertError.message })
      return
    }

    setEnrollSearchText('')
    await loadEnrolledStudents(selectedCourse)
    setEnrollmentMessage({ type: 'success', text: `${student.name} enrolled.` })
  }

  async function handleRemoveStudent(student) {
    const confirmed = window.confirm(
      `Remove ${student.name} from ${selectedCourse.name}? Their existing attendance records for this course will be preserved, but they will no longer appear on the active roster or be able to mark attendance.`,
    )
    if (!confirmed) return

    setRemovingPgpId(student.pgp_id)
    setEnrollmentMessage(null)

    const { error: deleteError } = await supabase
      .from('enrollments')
      .delete()
      .eq('course_id', selectedCourse.id)
      .eq('student_pgp_id', student.pgp_id)

    setRemovingPgpId(null)

    if (deleteError) {
      setEnrollmentMessage({ type: 'error', text: deleteError.message })
      return
    }

    await loadEnrolledStudents(selectedCourse)
    setEnrollmentMessage({ type: 'success', text: `${student.name} removed from the roster.` })
  }

  async function loadTimetableSlots(course) {
    setSlotsLoading(true)
    setSlotsError('')

    const shortCode = courseShortCode(course.name)
    const { data, error: slotsErr } = await supabase
      .from('timetable_slots')
      .select('id, day_of_week, start_time, end_time, section, room, is_functional')
      .eq('course_name', shortCode)

    if (slotsErr) {
      setSlotsError(slotsErr.message)
      setSlotsLoading(false)
      return
    }

    const sorted = (data ?? []).sort((a, b) => {
      const dayDiff = DAY_ORDER.indexOf(a.day_of_week) - DAY_ORDER.indexOf(b.day_of_week)
      return dayDiff !== 0 ? dayDiff : a.start_time.localeCompare(b.start_time)
    })

    setTimetableSlots(sorted)
    setSlotsLoading(false)
  }

  function handleOpenAddSlot() {
    setEditingSlotId(null)
    setSlotForm(emptySlotForm())
    setSlotFormError('')
    setTimetableMessage(null)
    setSlotFormOpen(true)
  }

  function handleOpenEditSlot(slot) {
    setEditingSlotId(slot.id)
    setSlotForm({
      day_of_week: slot.day_of_week,
      start_time: slot.start_time.slice(0, 5),
      end_time: slot.end_time.slice(0, 5),
      section: slot.section,
      room: slot.room,
      is_functional: slot.is_functional,
    })
    setSlotFormError('')
    setTimetableMessage(null)
    setSlotFormOpen(true)
  }

  function handleCloseSlotForm() {
    setSlotFormOpen(false)
    setEditingSlotId(null)
    setSlotFormError('')
  }

  async function handleSaveSlot() {
    setSlotFormError('')

    const { day_of_week, start_time, end_time, section, room, is_functional } = slotForm

    if (!section.trim() || !room.trim()) {
      setSlotFormError('Section and room are required.')
      return
    }

    if (timeToMinutes(start_time) >= timeToMinutes(end_time)) {
      setSlotFormError('End time must be after start time.')
      return
    }

    const overlap = timetableSlots.find(
      (s) =>
        s.id !== editingSlotId &&
        s.day_of_week === day_of_week &&
        timeRangesOverlap(`${start_time}:00`, `${end_time}:00`, s.start_time, s.end_time),
    )

    setSavingSlot(true)

    const payload = {
      day_of_week,
      start_time: `${start_time}:00`,
      end_time: `${end_time}:00`,
      course_name: courseShortCode(selectedCourse.name),
      section: section.trim(),
      room: room.trim(),
      is_functional,
      professor_identifier: 'prof',
    }

    const { error: saveError } = editingSlotId
      ? await supabase.from('timetable_slots').update(payload).eq('id', editingSlotId)
      : await supabase.from('timetable_slots').insert(payload)

    setSavingSlot(false)

    if (saveError) {
      setSlotFormError(saveError.message)
      return
    }

    await loadTimetableSlots(selectedCourse)
    handleCloseSlotForm()

    setTimetableMessage(
      overlap
        ? {
            type: 'warning',
            text: `Saved — but this overlaps with ${overlap.section} (${overlap.room}) on ${day_of_week}, ${overlap.start_time.slice(0, 5)}–${overlap.end_time.slice(0, 5)}. That's fine if it's intentional (e.g. two sections in different rooms at once).`,
          }
        : { type: 'success', text: editingSlotId ? 'Slot updated.' : 'Slot added.' },
    )
  }

  async function handleDeleteSlot() {
    if (!editingSlotId) return

    const confirmed = window.confirm(
      "Delete this timetable slot? Sessions already generated from it are unaffected — this only stops it from being included in future generation.",
    )
    if (!confirmed) return

    setSavingSlot(true)

    const { error: deleteError } = await supabase.from('timetable_slots').delete().eq('id', editingSlotId)

    setSavingSlot(false)

    if (deleteError) {
      setSlotFormError(deleteError.message)
      return
    }

    await loadTimetableSlots(selectedCourse)
    handleCloseSlotForm()
    setTimetableMessage({ type: 'success', text: 'Slot deleted.' })
  }

  const enrolledPgpIds = new Set(students.map((s) => s.pgp_id))
  const filteredUnenrolled =
    enrollSearchText.trim() === ''
      ? []
      : allStudents
          .filter((s) => !enrolledPgpIds.has(s.pgp_id))
          .filter((s) => {
            const q = enrollSearchText.toLowerCase()
            return s.name.toLowerCase().includes(q) || s.pgp_id.toLowerCase().includes(q)
          })
          .slice(0, 8)

  const functionalSlots = timetableSlots.filter((s) => s.is_functional)
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
      .select(
        'id, session_number, session_date, start_time, end_time, room, status, current_phase, timing_config, mid_class_enabled, cancellation_reason',
      )

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

  function handleOpenCourseForm() {
    setCourseForm(emptyCourseForm())
    setCourseFormError('')
    setCourseFormOpen(true)
  }

  function handleCloseCourseForm() {
    setCourseFormOpen(false)
    setCourseFormError('')
  }

  async function handleCreateCourse() {
    setCourseFormError('')

    const name = courseForm.name.trim()
    const professorName = courseForm.professor_name.trim()
    const totalSessions = Number(courseForm.total_sessions)
    const qrDuration = Number(courseForm.default_qr_duration_seconds)

    if (!name || !professorName) {
      setCourseFormError('Course name and professor name are required.')
      return
    }
    if (!Number.isInteger(totalSessions) || totalSessions <= 0) {
      setCourseFormError('Total sessions must be a positive whole number.')
      return
    }
    if (!Number.isInteger(qrDuration) || qrDuration <= 0) {
      setCourseFormError('Default QR duration must be a positive whole number.')
      return
    }

    setSavingCourse(true)

    const { data, error: insertError } = await supabase
      .from('courses')
      .insert({
        name,
        professor_name: professorName,
        total_sessions: totalSessions,
        default_qr_duration_seconds: qrDuration,
      })
      .select('id, name, professor_name, total_sessions, default_qr_duration_seconds')
      .single()

    setSavingCourse(false)

    if (insertError) {
      setCourseFormError(insertError.message)
      return
    }

    setCourses((prev) => [...prev, data])
    setSelectedCourseId(data.id)
    setCourseFormOpen(false)
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
        .select('id, session_number, status')
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
    // Cancelled sessions are kept as columns for record-keeping (so the numbering gap is
    // explained rather than silently missing), but excluded from the denominator — they
    // never happened, so they shouldn't count against anyone's attendance percentage.
    // not_started sessions are excluded too, for the same reason (matches the definition
    // of "conducted" already used in CourseDetail.jsx's student-facing attendance fraction) —
    // a session that hasn't happened yet shouldn't count against attendance either.
    const countableSessions = courseSessions.filter(
      (s) => s.status !== 'cancelled' && s.status !== 'not_started',
    )
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
        ...courseSessions.map((s) => (s.status === 'cancelled' ? `Session ${s.session_number} (Cancelled)` : `Session ${s.session_number}`)),
        'Total Present / Total Sessions',
      ],
    ]

    for (const student of courseStudents) {
      let presentCount = 0
      const cells = courseSessions.map((s) => {
        if (s.status === 'cancelled') return 'Cancelled'
        const present = attendedPairs.has(`${student.pgp_id}::${s.id}`)
        if (present) presentCount += 1
        return present ? 'Present' : 'Absent'
      })
      rows.push([student.pgp_id, student.name, ...cells, `${presentCount} / ${countableSessions.length}`])
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

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
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
          <button
            type="button"
            onClick={handleOpenCourseForm}
            title="Create New Course"
            className="rounded-lg border-2 border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500 transition hover:border-maroon-300 hover:text-maroon-600"
          >
            + New Course
          </button>
        </div>

        {courseFormOpen && (
          <CourseForm
            form={courseForm}
            onChange={setCourseForm}
            onSave={handleCreateCourse}
            onCancel={handleCloseCourseForm}
            saving={savingCourse}
            error={courseFormError}
          />
        )}

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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Weekly Timetable {slotsLoading ? '' : `(${timetableSlots.length})`}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Recurring weekly slots for <strong>{selectedCourse.name}</strong>. Functional slots
              generate real QR/scan sessions; placeholder slots are schedule-only.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAddSlot}
            className="shrink-0 rounded-lg bg-maroon-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-maroon-700"
          >
            Add Slot
          </button>
        </div>

        {timetableMessage && (
          <p
            role="alert"
            className={`mt-4 rounded-lg px-3.5 py-2.5 text-sm ${
              timetableMessage.type === 'error'
                ? 'bg-red-50 text-red-700'
                : timetableMessage.type === 'warning'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-green-50 text-green-700'
            }`}
          >
            {timetableMessage.text}
          </p>
        )}

        {slotFormOpen && (
          <SlotForm
            form={slotForm}
            onChange={setSlotForm}
            isEditing={editingSlotId !== null}
            onSave={handleSaveSlot}
            onDelete={handleDeleteSlot}
            onCancel={handleCloseSlotForm}
            saving={savingSlot}
            error={slotFormError}
          />
        )}

        <div className="mt-4 overflow-x-auto">
          {slotsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : slotsError ? (
            <p role="alert" className="text-sm text-red-700">
              {slotsError}
            </p>
          ) : timetableSlots.length === 0 ? (
            <p className="text-sm text-gray-400">No timetable slots configured for this course yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                  <th className="px-4 py-2.5">Day</th>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Section</th>
                  <th className="px-4 py-2.5">Room</th>
                  <th className="px-4 py-2.5">Type</th>
                </tr>
              </thead>
              <tbody>
                {timetableSlots.map((slot, i) => (
                  <tr
                    key={slot.id}
                    onClick={() => handleOpenEditSlot(slot)}
                    className={`cursor-pointer transition hover:bg-maroon-50 ${
                      i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">{slot.day_of_week}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-600">
                      {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{slot.section}</td>
                    <td className="px-4 py-2.5 text-gray-600">{slot.room}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          slot.is_functional ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {slot.is_functional ? 'Functional' : 'Placeholder'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Course Roster {studentsLoading ? '' : `(${students.length})`}
          </h2>
          <button
            type="button"
            onClick={() => {
              setManageEnrollmentOpen((v) => !v)
              setEnrollSearchText('')
              setEnrollmentMessage(null)
            }}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
          >
            {manageEnrollmentOpen ? 'Done' : 'Manage Enrollment'}
          </button>
        </div>

        {manageEnrollmentOpen && (
          <div className="border-b border-gray-100 px-6 py-4">
            <p className="text-sm font-medium text-gray-700">Add a student</p>
            <div className="relative mt-2">
              <input
                type="text"
                value={enrollSearchText}
                onChange={(e) => setEnrollSearchText(e.target.value)}
                placeholder="Search by name or PGP ID…"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
              />
              {enrollSearchText.trim() && filteredUnenrolled.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {filteredUnenrolled.map((s) => (
                    <li
                      key={s.pgp_id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm hover:bg-maroon-50"
                    >
                      <span>
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="ml-2 text-gray-500">{s.pgp_id}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleEnrollStudent(s)}
                        disabled={enrollingPgpId === s.pgp_id}
                        className="shrink-0 rounded-lg bg-maroon-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {enrollingPgpId === s.pgp_id ? 'Enrolling…' : 'Enroll'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {enrollSearchText.trim() && filteredUnenrolled.length === 0 && (
                <p className="mt-2 text-xs text-gray-400">No matching students, or already enrolled.</p>
              )}
            </div>

            {enrollmentMessage && (
              <p
                role="alert"
                className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ${
                  enrollmentMessage.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                }`}
              >
                {enrollmentMessage.text}
              </p>
            )}
          </div>
        )}

        {studentsLoading ? (
          <p className="px-6 py-4 text-sm text-gray-500">Loading…</p>
        ) : studentsError ? (
          <p role="alert" className="px-6 py-4 text-sm text-red-700">
            {studentsError}
          </p>
        ) : students.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-gray-500">No students enrolled yet.</p>
            {!manageEnrollmentOpen && (
              <p className="mt-1 text-xs text-gray-400">
                Click "Manage Enrollment" above to add students.
              </p>
            )}
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-100 text-xs font-medium tracking-wide text-gray-500 uppercase">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">PGP ID</th>
                  {manageEnrollmentOpen && <th className="px-6 py-3">Action</th>}
                </tr>
              </thead>
              <tbody>
                {students.map((student, i) => (
                  <tr key={student.pgp_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-3 font-medium text-gray-900">{student.name}</td>
                    <td className="px-6 py-3 text-gray-600">{student.pgp_id}</td>
                    {manageEnrollmentOpen && (
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          onClick={() => handleRemoveStudent(student)}
                          disabled={removingPgpId === student.pgp_id}
                          className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {removingPgpId === student.pgp_id ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session, i) => {
                  const isCancelled = session.status === 'cancelled'
                  const isNotStarted = session.status === 'not_started'
                  const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  const timeRange = formatTimeRange(session.start_time, session.end_time)
                  return (
                    <Fragment key={session.session_number}>
                      <tr className={`${rowBg} ${isCancelled ? 'opacity-50' : ''}`}>
                        <td className="px-6 py-3 font-medium text-gray-900">
                          {session.session_number}
                        </td>
                        <td className="px-6 py-3 text-gray-600">
                          <div>{displaySessionDate(session)}</div>
                          {(timeRange || session.room) && (
                            <div className="text-xs text-gray-400">
                              {timeRange ?? 'Time TBD'}
                              {session.room ? ` · ${session.room}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                              STATUS_STYLES[session.status] ?? 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {statusLabel(session.status)}
                          </span>
                          {isCancelled && session.cancellation_reason && (
                            <span className="ml-2 text-xs text-gray-400">
                              ({session.cancellation_reason})
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {(isNotStarted || isCancelled) && (
                            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                              <button
                                type="button"
                                onClick={() => handleOpenRescheduleForm(session)}
                                className="text-xs font-medium text-maroon-600 hover:text-maroon-800"
                              >
                                Reschedule
                              </button>
                              {isNotStarted && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkOffline(session)}
                                    disabled={markingOfflineSessionNumber === session.session_number}
                                    className="text-xs font-medium text-amber-700 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {markingOfflineSessionNumber === session.session_number
                                      ? 'Marking…'
                                      : 'Mark as Offline'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenCancelForm(session)}
                                    className="text-xs font-medium text-red-600 hover:text-red-800"
                                  >
                                    Cancel Session
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {session.status === 'manual_only' && (
                            <Link
                              to={`/professor/live/${session.id}`}
                              className="text-xs font-medium text-maroon-600 hover:text-maroon-800"
                            >
                              Go to Live page →
                            </Link>
                          )}
                        </td>
                      </tr>
                      {reschedulingSessionNumber === session.session_number && rescheduleForm && (
                        <tr className={rowBg}>
                          <td colSpan={4} className="px-6 pb-4">
                            <div className="rounded-lg border border-maroon-200 bg-maroon-50 p-3">
                              <p className="text-sm font-medium text-gray-700">
                                Reschedule Session {session.session_number}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                Saving this decouples the session from its original weekly slot —
                                it becomes a standalone override from here on.
                              </p>
                              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div>
                                  <label className="text-xs font-medium text-gray-600">Date</label>
                                  <input
                                    type="date"
                                    value={rescheduleForm.session_date}
                                    onChange={(e) =>
                                      setRescheduleForm({ ...rescheduleForm, session_date: e.target.value })
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-1 focus:ring-maroon-100"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-gray-600">Start time</label>
                                  <input
                                    type="time"
                                    value={rescheduleForm.start_time}
                                    onChange={(e) =>
                                      setRescheduleForm({ ...rescheduleForm, start_time: e.target.value })
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-1 focus:ring-maroon-100"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-gray-600">End time</label>
                                  <input
                                    type="time"
                                    value={rescheduleForm.end_time}
                                    onChange={(e) =>
                                      setRescheduleForm({ ...rescheduleForm, end_time: e.target.value })
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-1 focus:ring-maroon-100"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-gray-600">Room</label>
                                  <input
                                    type="text"
                                    value={rescheduleForm.room}
                                    onChange={(e) => setRescheduleForm({ ...rescheduleForm, room: e.target.value })}
                                    placeholder="e.g. CR-107"
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-1 focus:ring-maroon-100"
                                  />
                                </div>
                              </div>
                              {rescheduleError && (
                                <p role="alert" className="mt-2 text-xs text-red-700">
                                  {rescheduleError}
                                </p>
                              )}
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveReschedule(session)}
                                  disabled={rescheduling}
                                  className="rounded-lg bg-maroon-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {rescheduling ? 'Saving…' : 'Save Reschedule'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCloseRescheduleForm}
                                  disabled={rescheduling}
                                  className="rounded-lg px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                                >
                                  Nevermind
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {cancellingSessionNumber === session.session_number && (
                        <tr className={rowBg}>
                          <td colSpan={4} className="px-6 pb-4">
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                              <p className="text-sm font-medium text-gray-700">
                                Cancel Session {session.session_number}?
                              </p>
                              <input
                                type="text"
                                value={cancelReasonInput}
                                onChange={(e) => setCancelReasonInput(e.target.value)}
                                placeholder="Reason (e.g. Holiday, Exam week)"
                                className="mt-2 w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
                              />
                              {cancelError && (
                                <p role="alert" className="mt-2 text-xs text-red-700">
                                  {cancelError}
                                </p>
                              )}
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmCancelSession(session)}
                                  disabled={cancelling}
                                  className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCloseCancelForm}
                                  disabled={cancelling}
                                  className="rounded-lg px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                                >
                                  Nevermind
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-base font-semibold text-gray-900">Analytics</h2>
        <p className="mt-1 text-sm text-gray-500">
          A quick glance at attendance trends for <strong>{selectedCourse.name}</strong>.
        </p>

        {analyticsLoading ? (
          <p className="mt-4 text-sm text-gray-500">Loading…</p>
        ) : analyticsError ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {analyticsError}
          </p>
        ) : attendanceOverTime.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">No conducted sessions yet to analyze.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-900">Attendance Rate Over Time</h3>
              <p className="mt-0.5 text-xs text-gray-400">
                % of enrolled students present, per conducted session.
              </p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={attendanceOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="session" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Line type="monotone" dataKey="rate" stroke="#7a1e2b" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-900">Per-Student Attendance Distribution</h3>
              <p className="mt-0.5 text-xs text-gray-400">
                How many enrolled students fall into each attendance band.
              </p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {distributionData.map((entry) => (
                        <Cell key={entry.band} fill={DISTRIBUTION_BAND_COLORS[entry.band]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900">Verification Method Breakdown</h3>
              <p className="mt-0.5 text-xs text-gray-400">
                QR scan (device/location-verified) vs. manual entry (no-device fallback).
              </p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={methodBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                      {methodBreakdown.map((entry) => (
                        <Cell key={entry.name} fill={METHOD_COLORS[entry.name]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}

function CourseForm({ form, onChange, onSave, onCancel, saving, error }) {
  function setField(field, value) {
    onChange({ ...form, [field]: value })
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-5">
      <h3 className="text-sm font-semibold text-gray-900">Create New Course</h3>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-sm font-medium text-gray-700">Course name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="e.g. Marketing Management — Section A"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="text-sm font-medium text-gray-700">Professor name</label>
          <input
            type="text"
            value={form.professor_name}
            onChange={(e) => setField('professor_name', e.target.value)}
            placeholder="e.g. Prof Jane Doe"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Total sessions planned</label>
          <input
            type="number"
            min="1"
            value={form.total_sessions}
            onChange={(e) => setField('total_sessions', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Default QR duration (seconds)</label>
          <input
            type="number"
            min="1"
            value={form.default_qr_duration_seconds}
            onChange={(e) => setField('default_qr_duration_seconds', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Creating…' : 'Create Course'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-6 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SlotForm({ form, onChange, isEditing, onSave, onDelete, onCancel, saving, error }) {
  function setField(field, value) {
    onChange({ ...form, [field]: value })
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-5">
      <h3 className="text-sm font-semibold text-gray-900">{isEditing ? 'Edit Slot' : 'Add Slot'}</h3>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-gray-700">Day of week</label>
          <select
            value={form.day_of_week}
            onChange={(e) => setField('day_of_week', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          >
            {DAY_ORDER.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700">Start time</label>
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => setField('start_time', e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700">End time</label>
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => setField('end_time', e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Section</label>
          <input
            type="text"
            value={form.section}
            onChange={(e) => setField('section', e.target.value)}
            placeholder="e.g. Sec A"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Room</label>
          <input
            type="text"
            value={form.room}
            onChange={(e) => setField('room', e.target.value)}
            placeholder="e.g. CR-107"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-gray-900 outline-none transition focus:border-maroon-600 focus:ring-2 focus:ring-maroon-100"
          />
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 rounded-lg bg-white p-3.5">
        <span>
          <span className="block text-sm font-medium text-gray-700">
            Enable real QR/scan attendance for this slot
          </span>
          <span className="block text-xs text-gray-400">
            {form.is_functional
              ? 'Sessions generated from this slot will run live QR attendance.'
              : 'Show as schedule only — no sessions will be generated from this slot.'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={form.is_functional}
          onClick={() => setField('is_functional', !form.is_functional)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            form.is_functional ? 'bg-maroon-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              form.is_functional ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-maroon-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Slot'}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="rounded-lg border border-red-300 px-6 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete Slot
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-6 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
        >
          Cancel
        </button>
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
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-10">{children}</div>
}
