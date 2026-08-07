import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import {
  addDaysToDateString,
  dayAbbrevForDateString,
  formatDateIST,
  formatTimeRange,
  getTodayISTDateString,
} from '../lib/dateFormat.js'
import { courseShortCode } from '../lib/csv.js'
import UserMenu from '../components/UserMenu.jsx'

// This prototype only has one professor login (prof), which is deliberately given
// visibility into every seeded course's timetable_slots — standing in for what would be
// separate per-professor accounts in production, each seeing only their own slots via
// professor_identifier matching their own login. Since that means this single account's
// schedule can show other professors' classes too (BDC, SOM), each non-DTAI slot is
// labeled with its real course/professor so that's visually obvious rather than looking
// like a data bug. See ARCHITECTURE_NOTES.md for the fuller explanation.
const PROFESSOR_IDENTIFIER = 'prof'
const UPCOMING_WINDOW_DAYS = 21

function otherCourseLabel(slot, courses) {
  if (slot.course_name === 'DTAI') return null
  const course = courses.find((c) => courseShortCode(c.name) === slot.course_name)
  if (!course) return null
  return `${slot.course_name} · ${course.professor_name}`
}

export default function Professor() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState([])
  const [upcomingSessions, setUpcomingSessions] = useState([])
  const [demoSlotOccurrences, setDemoSlotOccurrences] = useState([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError('')

      const todayString = getTodayISTDateString()
      const windowEndString = addDaysToDateString(todayString, UPCOMING_WINDOW_DAYS)

      const [nonFunctionalSlotsRes, coursesRes, upcomingRes] = await Promise.all([
        // Only non-functional slots are needed here — functional slots never appear as their
        // own template anymore; once generated they already show up as real rows in `sessions`,
        // reachable through the query below. That recurring-pattern view still lives (and is
        // editable) in Admin's Weekly Timetable.
        supabase
          .from('timetable_slots')
          .select('id, day_of_week, start_time, end_time, course_name, section, room')
          .eq('professor_identifier', PROFESSOR_IDENTIFIER)
          .eq('is_functional', false),
        supabase.from('courses').select('id, name, professor_name'),
        // Slot/weekday matching breaks the moment a session is rescheduled to a different day
        // than its usual slot — this queries sessions directly by real date instead, so a
        // rescheduled or admin-created session is always reachable regardless of what day it
        // now falls on.
        supabase
          .from('sessions')
          .select('id, session_number, session_date, status, start_time, end_time, room, course_id, courses(name)')
          .neq('status', 'cancelled')
          .gte('session_date', todayString)
          .lte('session_date', windowEndString)
          .order('session_date'),
      ])

      if (nonFunctionalSlotsRes.error) {
        setError(nonFunctionalSlotsRes.error.message)
        setLoading(false)
        return
      }
      if (coursesRes.error) {
        setError(coursesRes.error.message)
        setLoading(false)
        return
      }
      if (upcomingRes.error) {
        setError(upcomingRes.error.message)
        setLoading(false)
        return
      }

      // Non-functional slots never generate real session rows, so their upcoming real-date
      // occurrences within the same window have to be computed the same way session generation
      // itself would — by walking each date in the window and matching its weekday.
      const occurrences = []
      for (let offset = 0; offset <= UPCOMING_WINDOW_DAYS; offset++) {
        const date = addDaysToDateString(todayString, offset)
        const weekday = dayAbbrevForDateString(date)
        for (const slot of nonFunctionalSlotsRes.data ?? []) {
          if (slot.day_of_week === weekday) {
            occurrences.push({ id: `${slot.id}-${date}`, date, slot })
          }
        }
      }

      setCourses(coursesRes.data ?? [])
      setUpcomingSessions(upcomingRes.data ?? [])
      setDemoSlotOccurrences(occurrences)
      setLoading(false)
    }

    loadData()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])

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

  // Real scheduled instances and demo-only slot occurrences are merged into one chronological
  // list — mixing them by date is the point, not splitting them into separate sections.
  const entries = [
    ...upcomingSessions.map((session) => ({ kind: 'session', date: session.session_date, session })),
    ...demoSlotOccurrences.map((occ) => ({ kind: 'demo', date: occ.date, slot: occ.slot })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <PageShell>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-maroon-50 text-maroon-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-maroon-600">Professor Dashboard</p>
              <h1 className="mt-0.5 text-2xl font-bold text-gray-900 sm:text-3xl">
                Upcoming Sessions
              </h1>
            </div>
          </div>
          <UserMenu />
        </div>
      </Card>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm text-gray-500">
          Every session in the next {UPCOMING_WINDOW_DAYS} days, by real date — including anything
          rescheduled off its usual weekly slot. For the recurring weekly pattern, see Admin's
          Weekly Timetable.
        </p>

        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">No sessions scheduled in this window.</p>
        ) : (
          <div className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100">
            {entries.map((entry) =>
              entry.kind === 'session' ? (
                <SessionRow key={entry.session.id} session={entry.session} onClick={() => navigate(`/professor/live/${entry.session.id}`)} />
              ) : (
                <DemoSlotRow
                  key={entry.slot.id + entry.date}
                  date={entry.date}
                  slot={entry.slot}
                  otherLabel={otherCourseLabel(entry.slot, courses)}
                  onClick={() => setToast('Not enabled for this prototype demo')}
                />
              ),
            )}
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

function SessionRow({ session, onClick }) {
  const timeRange = formatTimeRange(session.start_time, session.end_time)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-maroon-50"
    >
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {session.courses?.name ?? 'Unknown course'} · Session {session.session_number}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {formatDateIST(session.session_date)}
          {timeRange ? ` · ${timeRange}` : ' · Time TBD'}
          {session.room ? ` · ${session.room}` : ''}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
        {session.status === 'not_started' ? 'Not started' : session.status}
      </span>
    </button>
  )
}

function DemoSlotRow({ date, slot, otherLabel, onClick }) {
  const timeRange = formatTimeRange(slot.start_time, slot.end_time)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-gray-50 px-4 py-3 text-left"
    >
      <div>
        <p className="text-sm font-semibold text-gray-500">
          {slot.course_name} · {slot.section}
          {otherLabel && (
            <span className="ml-2 inline-flex rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
              {otherLabel}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          {formatDateIST(date)}
          {timeRange ? ` · ${timeRange}` : ''}
          {slot.room ? ` · ${slot.room}` : ''}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500">
        Demo only
      </span>
    </button>
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
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-8">{children}</div>
}
