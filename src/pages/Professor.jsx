import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import {
  addDaysToDateString,
  dayAbbrevForDateString,
  daysInMonth,
  formatTimeRange,
  getTodayISTDateString,
} from '../lib/dateFormat.js'
import { courseSectionSuffix, courseShortCode, findCourseForSlot } from '../lib/csv.js'
import UserMenu from '../components/UserMenu.jsx'

// This prototype only has one professor login, which is deliberately given visibility into
// every seeded course's timetable_slots — standing in for what would be separate
// per-professor accounts in production, each seeing only their own slots via
// professor_identifier matching their own login. Since that means this single account's
// calendar can show other professors' classes too (BDC, SOM), each non-DTAI slot is
// labeled with its real course/professor so that's visually obvious rather than looking
// like a data bug. See ARCHITECTURE_NOTES.md for the fuller explanation.
//
// timetable_slots.professor_identifier for this login's rows is 'prof_dtai_itc' in the
// database (distinct from the 'prof' login identifier used for verify_login) — must match
// exactly, or every non-functional "Demo only" slot silently disappears from the calendar.
const PROFESSOR_IDENTIFIER = 'prof_dtai_itc'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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

export default function Professor() {
  const navigate = useNavigate()
  const todayString = getTodayISTDateString()
  const todayDate = new Date(`${todayString}T00:00:00Z`)

  const [viewedYear, setViewedYear] = useState(todayDate.getUTCFullYear())
  const [viewedMonth, setViewedMonth] = useState(todayDate.getUTCMonth())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState([])
  const [nonFunctionalSlots, setNonFunctionalSlots] = useState([])
  const [sessionsInView, setSessionsInView] = useState([])
  const [toast, setToast] = useState('')

  // Courses and non-functional slots don't change per month view — fetched once.
  useEffect(() => {
    async function loadStatic() {
      const [coursesRes, slotsRes] = await Promise.all([
        supabase.from('courses').select('id, name, professor_name'),
        supabase
          .from('timetable_slots')
          .select('id, day_of_week, start_time, end_time, course_name, section, room')
          .eq('professor_identifier', PROFESSOR_IDENTIFIER)
          .eq('is_functional', false),
      ])

      if (coursesRes.error) {
        setError(coursesRes.error.message)
        return
      }
      if (slotsRes.error) {
        setError(slotsRes.error.message)
        return
      }

      setCourses(coursesRes.data ?? [])
      setNonFunctionalSlots(slotsRes.data ?? [])
    }

    loadStatic()
  }, [])

  // Real sessions are re-fetched for whichever month is currently in view, so Back/Forward
  // navigation reaches any month, not just a fixed window from today.
  useEffect(() => {
    async function loadSessions() {
      setLoading(true)
      setError('')

      const gridDates = buildMonthGridDates(viewedYear, viewedMonth)
      const gridStart = gridDates[0]
      const gridEnd = gridDates[gridDates.length - 1]

      const { data, error: sessionsError } = await supabase
        .from('sessions')
        .select('id, session_number, session_date, status, start_time, end_time, room, course_id, courses(name)')
        .neq('status', 'cancelled')
        .gte('session_date', gridStart)
        .lte('session_date', gridEnd)

      if (sessionsError) {
        setError(sessionsError.message)
        setLoading(false)
        return
      }

      setSessionsInView(data ?? [])
      setLoading(false)
    }

    loadSessions()
  }, [viewedYear, viewedMonth])

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
              const weekday = dayAbbrevForDateString(date)

              const realSessions = sessionsByDate.get(date) ?? []
              const demoOccurrences = nonFunctionalSlots.filter((slot) => slot.day_of_week === weekday)

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
                    {realSessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => navigate(`/professor/live/${session.id}`)}
                        className="block w-full rounded border-l-2 border-maroon-500 bg-maroon-50 px-1.5 py-1 text-left transition hover:bg-maroon-100"
                      >
                        <p className="truncate text-[11px] font-semibold text-maroon-800">
                          {courseShortCode(session.courses?.name ?? '')}
                          {courseSectionSuffix(session.courses?.name ?? '') ? ` ${courseSectionSuffix(session.courses?.name ?? '')}` : ''}
                          {' '}· S{session.session_number}
                        </p>
                        <p className="truncate text-[10px] text-maroon-700">
                          {formatTimeRange(session.start_time, session.end_time) ?? 'Time TBD'}
                          {session.room ? ` · ${session.room}` : ''}
                        </p>
                      </button>
                    ))}

                    {demoOccurrences.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => setToast('Not enabled for this prototype demo')}
                        className="block w-full rounded bg-gray-100 px-1.5 py-1 text-left"
                      >
                        <p className="truncate text-[11px] font-medium text-gray-500">
                          {slot.course_name} · {slot.section}
                        </p>
                        <p className="truncate text-[10px] text-gray-400">
                          {formatTimeRange(slot.start_time, slot.end_time)}
                          {slot.room ? ` · ${slot.room}` : ''}
                        </p>
                        {otherCourseLabel(slot, courses) && (
                          <p className="truncate text-[9px] text-indigo-500">{otherCourseLabel(slot, courses)}</p>
                        )}
                      </button>
                    ))}
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
