import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabaseClient.js'
import {
  addDaysToDateString,
  dayAbbrevForDateString,
  daysInMonth,
  formatTimeRange,
  getTodayISTDateString,
} from '../lib/dateFormat.js'
import { courseSectionSuffix, courseShortCode, findCourseForSlot } from '../lib/csv.js'
import { PROFESSOR_IDENTIFIER } from '../lib/constants.js'
import UserMenu from '../components/UserMenu.jsx'

// This professor's real, visible courses are derived strictly from timetable_slots rows
// tagged with PROFESSOR_IDENTIFIER — not "every course that happens to exist," so a course
// this professor doesn't teach (BDC, SOM) never appears here even if it has real sessions of
// its own elsewhere in the app.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ITC has never had a real course entity — only non-functional timetable_slots — so its
// numbered occurrences are computed display-layer, not backed by real sessions rows. Each
// (course_name, section) pairing gets its own 1..10 sequential numbering from this epoch,
// mirroring how a real functional course's session-generation cap would behave.
const NON_FUNCTIONAL_EPOCH = '2026-07-15'
const NON_FUNCTIONAL_TOTAL_SESSIONS = 10

function dateStringFor(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthLabel(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

// Full Mon-Sun weeks covering the month, including padding days from the adjacent months so
// every row is a complete week — the standard month-grid shape.
function buildMonthGridDates(year, monthIndex) {
  const firstOfMonth = dateStringFor(year, monthIndex, 1)
  const firstIndex = WEEKDAYS.indexOf(dayAbbrevForDateString(firstOfMonth))
  const gridStart = addDaysToDateString(firstOfMonth, -firstIndex)

  const lastOfMonth = dateStringFor(year, monthIndex, daysInMonth(year, monthIndex))
  const lastIndex = WEEKDAYS.indexOf(dayAbbrevForDateString(lastOfMonth))
  const gridEnd = addDaysToDateString(lastOfMonth, 6 - lastIndex)

  const dates = []
  for (let d = gridStart; d <= gridEnd; d = addDaysToDateString(d, 1)) {
    dates.push(d)
  }
  return dates
}

function otherCourseLabel(slot, courses) {
  if (slot.course_name === 'DTAI') return null
  // course_name is a short-code text field, not a foreign key — findCourseForSlot resolves the
  // section ambiguity a shared short code (e.g. two DTAI sections) would otherwise create.
  const course = findCourseForSlot(courses, slot)
  if (!course) return null
  return `${slot.course_name} · ${course.professor_name}`
}

// Groups non-functional slots by (course_name, section) — e.g. ITC/Sec H and ITC/Sec I are two
// independent series — and walks forward day-by-day from the shared epoch assigning each real
// calendar occurrence the next sequential number, stopping at NON_FUNCTIONAL_TOTAL_SESSIONS per
// series. Returns a Map<dateString, Array<{ slot, number }>> covering only the first 10
// occurrences of each series — nothing is ever computed (or shown) beyond that cap.
function buildNonFunctionalOccurrences(slots) {
  const groups = new Map()
  for (const slot of slots) {
    const key = `${slot.course_name}::${slot.section}`
    const list = groups.get(key) ?? []
    list.push(slot)
    groups.set(key, list)
  }

  const occurrencesByDate = new Map()
  for (const groupSlots of groups.values()) {
    let count = 0
    let cursor = NON_FUNCTIONAL_EPOCH
    // 400 days is a generous ceiling — real cadence here is 1-2x/week, so 10 occurrences
    // always resolve well within a year.
    for (let i = 0; i < 400 && count < NON_FUNCTIONAL_TOTAL_SESSIONS; i++) {
      const weekday = dayAbbrevForDateString(cursor)
      const matchingSlot = groupSlots.find((s) => s.day_of_week === weekday)
      if (matchingSlot) {
        count += 1
        const list = occurrencesByDate.get(cursor) ?? []
        list.push({ slot: matchingSlot, number: count })
        occurrencesByDate.set(cursor, list)
      }
      cursor = addDaysToDateString(cursor, 1)
    }
  }
  return occurrencesByDate
}

function getNowISTTimeString() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })
}

// Five real-world states, purely by date/time — not by status:
//   grey       — a future date (not today)
//   light      — today, before start_time
//   dark       — today, between start_time and end_time (genuinely happening right now)
//   Color A    — already past, attendance predominantly qr_scan
//   Color B    — already past, attendance predominantly manual_entry (or no records at all)
function sessionTimeState(session, todayString, nowTimeString) {
  const { session_date, start_time, end_time } = session

  if (session_date > todayString) return 'future'

  if (session_date === todayString) {
    if (start_time && end_time && nowTimeString >= start_time && nowTimeString <= end_time) {
      return 'ongoing'
    }
    if (start_time && nowTimeString < start_time) {
      return 'today-pending'
    }
    if (!end_time || nowTimeString > end_time) {
      return 'past'
    }
    return 'today-pending'
  }

  return 'past'
}

function sessionColorClasses(timeState, methodCounts) {
  if (timeState === 'past') {
    const counts = methodCounts ?? { qr_scan: 0, manual_entry: 0 }
    const qrPredominant = counts.qr_scan > 0 && counts.qr_scan >= counts.manual_entry
    return qrPredominant
      ? {
          wrapper: 'block w-full rounded border-l-2 border-sky-500 bg-sky-50 px-1.5 py-1 text-left transition hover:bg-sky-100',
          title: 'text-sky-800',
          subtitle: 'text-sky-700',
        }
      : {
          wrapper: 'block w-full rounded border-l-2 border-violet-500 bg-violet-50 px-1.5 py-1 text-left transition hover:bg-violet-100',
          title: 'text-violet-800',
          subtitle: 'text-violet-700',
        }
  }
  if (timeState === 'ongoing') {
    return {
      wrapper: 'block w-full rounded border-l-2 border-amber-800 bg-amber-600 px-1.5 py-1 text-left transition hover:bg-amber-700',
      title: 'text-white',
      subtitle: 'text-amber-50',
    }
  }
  if (timeState === 'today-pending') {
    return {
      wrapper: 'block w-full rounded border-l-2 border-amber-400 bg-amber-50 px-1.5 py-1 text-left transition hover:bg-amber-100',
      title: 'text-amber-800',
      subtitle: 'text-amber-700',
    }
  }
  return {
    wrapper: 'block w-full rounded border-l-2 border-gray-400 bg-gray-100 px-1.5 py-1 text-left transition hover:bg-gray-200',
    title: 'text-gray-600',
    subtitle: 'text-gray-500',
  }
}

function sessionStateLabel(timeState, methodCounts) {
  if (timeState === 'past') {
    const counts = methodCounts ?? { qr_scan: 0, manual_entry: 0 }
    if (counts.qr_scan === 0 && counts.manual_entry === 0) return 'No attendance recorded'
    return counts.qr_scan >= counts.manual_entry ? 'Taken via QR' : 'Taken manually'
  }
  if (timeState === 'ongoing') return 'Happening now'
  if (timeState === 'today-pending') return 'Later today'
  return 'Upcoming'
}

export default function Professor() {
  const navigate = useNavigate()
  const [todayString, setTodayString] = useState(getTodayISTDateString())
  const [nowTimeString, setNowTimeString] = useState(getNowISTTimeString())
  const todayDate = new Date(`${todayString}T00:00:00Z`)

  const [viewedYear, setViewedYear] = useState(todayDate.getUTCFullYear())
  const [viewedMonth, setViewedMonth] = useState(todayDate.getUTCMonth())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState([])
  const [nonFunctionalSlots, setNonFunctionalSlots] = useState([])
  const [myCourseIds, setMyCourseIds] = useState(null) // null = not yet resolved
  const [sessionsInView, setSessionsInView] = useState([])
  const [methodCountsBySession, setMethodCountsBySession] = useState(new Map())
  const [toast, setToast] = useState('')

  // Refreshed periodically so "ongoing right now" genuinely activates/deactivates live, not
  // just once at page load.
  useEffect(() => {
    const interval = setInterval(() => {
      setTodayString(getTodayISTDateString())
      setNowTimeString(getNowISTTimeString())
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // Courses and this professor's timetable_slots don't change per month view — fetched once.
  // Only functional slots contribute to myCourseIds: a course whose slots are all
  // non-functional (ITC) is display-layer only and should never be treated as "real."
  useEffect(() => {
    async function loadStatic() {
      const [coursesRes, slotsRes] = await Promise.all([
        supabase.from('courses').select('id, name, professor_name'),
        supabase
          .from('timetable_slots')
          .select('id, day_of_week, start_time, end_time, course_name, section, room, is_functional')
          .eq('professor_identifier', PROFESSOR_IDENTIFIER),
      ])

      if (coursesRes.error) {
        setError(coursesRes.error.message)
        return
      }
      if (slotsRes.error) {
        setError(slotsRes.error.message)
        return
      }

      const allCourses = coursesRes.data ?? []
      const allSlots = slotsRes.data ?? []

      const courseIdSet = new Set()
      for (const slot of allSlots) {
        if (!slot.is_functional) continue
        const course = findCourseForSlot(allCourses, slot)
        if (course) courseIdSet.add(course.id)
      }

      setCourses(allCourses)
      setNonFunctionalSlots(allSlots.filter((s) => !s.is_functional))
      setMyCourseIds(courseIdSet)
    }

    loadStatic()
  }, [])

  const nonFunctionalOccurrences = useMemo(
    () => buildNonFunctionalOccurrences(nonFunctionalSlots),
    [nonFunctionalSlots],
  )

  // Real sessions are re-fetched for whichever month is currently in view, so Back/Forward
  // navigation reaches any month, not just a fixed window from today.
  useEffect(() => {
    if (!myCourseIds) return // wait until this professor's course scope is resolved

    async function loadSessions() {
      setLoading(true)
      setError('')

      if (myCourseIds.size === 0) {
        setSessionsInView([])
        setLoading(false)
        return
      }

      const gridDates = buildMonthGridDates(viewedYear, viewedMonth)
      const gridStart = gridDates[0]
      const gridEnd = gridDates[gridDates.length - 1]

      const { data, error: sessionsError } = await supabase
        .from('sessions')
        .select('id, session_number, session_date, status, start_time, end_time, room, course_id, courses(name)')
        .gte('session_date', gridStart)
        .lte('session_date', gridEnd)
        .in('course_id', [...myCourseIds])

      if (sessionsError) {
        setError(sessionsError.message)
        setLoading(false)
        return
      }

      const sessions = data ?? []
      setSessionsInView(sessions)

      // Only past sessions need an attendance-method breakdown — future/today sessions can't
      // have any yet.
      const pastIds = sessions
        .filter((s) => sessionTimeState(s, todayString, nowTimeString) === 'past')
        .map((s) => s.id)

      if (pastIds.length > 0) {
        // Fetched with explicit pagination — a plain, un-paginated fetch here silently drops
        // rows past PostgREST's default 1000-row cap once enough past sessions accumulate in
        // one month's view, and non-deterministically so (no natural order otherwise), which is
        // exactly what caused the same session to show different attendance status depending on
        // which month happened to be open.
        const { data: arData } = await fetchAllRows(() =>
          supabase
            .from('attendance_records')
            .select('session_id, method')
            .in('session_id', pastIds)
            .order('id', { ascending: true }),
        )

        const counts = new Map()
        for (const row of arData ?? []) {
          const entry = counts.get(row.session_id) ?? { qr_scan: 0, manual_entry: 0 }
          if (row.method === 'qr_scan') entry.qr_scan += 1
          else if (row.method === 'manual_entry') entry.manual_entry += 1
          counts.set(row.session_id, entry)
        }
        setMethodCountsBySession(counts)
      } else {
        setMethodCountsBySession(new Map())
      }

      setLoading(false)
    }

    loadSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedYear, viewedMonth, myCourseIds])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])

  function goToPreviousMonth() {
    if (viewedMonth === 0) {
      setViewedYear((y) => y - 1)
      setViewedMonth(11)
    } else {
      setViewedMonth((m) => m - 1)
    }
  }

  function goToNextMonth() {
    if (viewedMonth === 11) {
      setViewedYear((y) => y + 1)
      setViewedMonth(0)
    } else {
      setViewedMonth((m) => m + 1)
    }
  }

  function goToToday() {
    setViewedYear(todayDate.getUTCFullYear())
    setViewedMonth(todayDate.getUTCMonth())
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

  const gridDates = buildMonthGridDates(viewedYear, viewedMonth)
  const sessionsByDate = new Map()
  for (const session of sessionsInView) {
    const list = sessionsByDate.get(session.session_date) ?? []
    list.push(session)
    sessionsByDate.set(session.session_date, list)
  }

  return (
    <PageShell>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-maroon-50 text-maroon-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-maroon-600">Professor Dashboard</p>
              <h1 className="mt-0.5 text-2xl font-bold text-gray-900 sm:text-3xl">
                {monthLabel(viewedYear, viewedMonth)}
              </h1>
            </div>
          </div>
          <UserMenu />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPreviousMonth}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition hover:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition hover:bg-gray-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={goToToday}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
          >
            Today
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Real scheduled sessions by date — including anything rescheduled off its usual weekly
          slot. For the recurring weekly pattern itself, see Admin's Weekly Timetable.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <LegendSwatch className="bg-gray-100 border-gray-400" label="Future" />
          <LegendSwatch className="bg-amber-50 border-amber-400" label="Today · not started" />
          <LegendSwatch className="bg-amber-600 border-amber-800" label="Today · ongoing" />
          <LegendSwatch className="bg-sky-50 border-sky-500" label="Ended · mostly QR" />
          <LegendSwatch className="bg-violet-50 border-violet-500" label="Ended · mostly manual" />
        </div>
      </Card>

      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-gray-500 uppercase">
              {day}
            </div>
          ))}
        </div>

        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="grid grid-cols-7">
            {gridDates.map((date) => {
              const inCurrentMonth = Number(date.slice(5, 7)) - 1 === viewedMonth
              const isToday = date === todayString
              const dayNumber = Number(date.slice(8, 10))

              const realSessions = sessionsByDate.get(date) ?? []
              const demoOccurrences = nonFunctionalOccurrences.get(date) ?? []

              // Merged and sorted by start_time ascending, real and demo entries mixed by
              // actual time of day rather than shown as two separate groups.
              const entries = [
                ...realSessions.map((session) => ({ kind: 'real', time: session.start_time ?? '99:99:99', session })),
                ...demoOccurrences.map((occ) => ({ kind: 'demo', time: occ.slot.start_time ?? '99:99:99', occ })),
              ].sort((a, b) => a.time.localeCompare(b.time))

              return (
                <div
                  key={date}
                  className={`min-h-[6.5rem] border-b border-r border-gray-100 p-1.5 ${
                    inCurrentMonth ? 'bg-white' : 'bg-gray-50/60'
                  }`}
                >
                  <p
                    className={`text-xs font-medium ${
                      isToday
                        ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-maroon-600 text-white'
                        : inCurrentMonth
                          ? 'text-gray-700'
                          : 'text-gray-300'
                    }`}
                  >
                    {dayNumber}
                  </p>

                  <div className="mt-1 space-y-1">
                    {entries.map((entry) => {
                      if (entry.kind === 'demo') {
                        const { slot, number } = entry.occ
                        // Same date-based coloring as a real session — built from this specific
                        // occurrence's date and the slot's fixed time, since a demo entry has no
                        // status of its own to key off. It never has real attendance_records, so
                        // a "past" occurrence always falls to the "no records" treatment.
                        const demoTimeState = sessionTimeState(
                          { session_date: date, start_time: slot.start_time, end_time: slot.end_time },
                          todayString,
                          nowTimeString,
                        )
                        const colors = sessionColorClasses(demoTimeState, undefined)
                        return (
                          <button
                            key={`${slot.id}-${date}`}
                            type="button"
                            onClick={() => setToast('Not enabled for this prototype demo')}
                            className={colors.wrapper}
                          >
                            <p className={`truncate text-[11px] font-semibold ${colors.title}`}>
                              {slot.course_name} · {slot.section} · S{number} (Demo)
                            </p>
                            <p className={`truncate text-[10px] ${colors.subtitle}`}>
                              {formatTimeRange(slot.start_time, slot.end_time)}
                              {slot.room ? ` · ${slot.room}` : ''}
                            </p>
                            <p className={`truncate text-[9px] font-medium ${colors.subtitle}`}>
                              {sessionStateLabel(demoTimeState, undefined)}
                            </p>
                            {otherCourseLabel(slot, courses) && (
                              <p className={`truncate text-[9px] ${colors.subtitle}`}>{otherCourseLabel(slot, courses)}</p>
                            )}
                          </button>
                        )
                      }

                      const session = entry.session
                      const timeState = sessionTimeState(session, todayString, nowTimeString)
                      const counts = methodCountsBySession.get(session.id)
                      const colors = sessionColorClasses(timeState, counts)
                      const sectionSuffix = courseSectionSuffix(session.courses?.name ?? '')

                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => navigate(`/professor/live/${session.id}`)}
                          className={colors.wrapper}
                        >
                          <p className={`truncate text-[11px] font-semibold ${colors.title}`}>
                            {courseShortCode(session.courses?.name ?? '')}
                            {sectionSuffix ? ` ${sectionSuffix}` : ''}
                            {' '}· S{session.session_number}
                          </p>
                          <p className={`truncate text-[10px] ${colors.subtitle}`}>
                            {formatTimeRange(session.start_time, session.end_time) ?? 'Time TBD'}
                            {session.room ? ` · ${session.room}` : ''}
                          </p>
                          <p className={`truncate text-[9px] font-medium ${colors.subtitle}`}>
                            {sessionStateLabel(timeState, counts)}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </PageShell>
  )
}

function LegendSwatch({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm border-l-2 ${className}`} />
      {label}
    </span>
  )
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  )
}

function Card({ children }) {
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-8">{children}</div>
}
