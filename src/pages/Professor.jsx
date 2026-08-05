import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { dateForDayInWeekOf, getTodayISTDateString, getTodayISTDayAbbrev } from '../lib/dateFormat.js'
import { courseShortCode } from '../lib/csv.js'
import UserMenu from '../components/UserMenu.jsx'

// This prototype only has one professor login (prof_dtai), which is deliberately given
// visibility into every seeded course's timetable_slots — standing in for what would be
// separate per-professor accounts in production, each seeing only their own slots via
// professor_identifier matching their own login. Since that means this single account's
// calendar can show other professors' classes too (BDC, SOM), each non-DTAI slot is
// labeled with its real course/professor so that's visually obvious rather than looking
// like a data bug. See ARCHITECTURE_NOTES.md for the fuller explanation.
const PROFESSOR_IDENTIFIER = 'prof_dtai'
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatTimeRange(startTime, endTime) {
  return `${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`
}

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
  const [slots, setSlots] = useState([])
  const [courses, setCourses] = useState([])
  const [resolvingSlotId, setResolvingSlotId] = useState(null)
  const [toast, setToast] = useState('')

  const today = getTodayISTDayAbbrev()

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError('')

      const [slotsRes, coursesRes] = await Promise.all([
        supabase
          .from('timetable_slots')
          .select('id, day_of_week, start_time, end_time, course_name, section, room, is_functional')
          .eq('professor_identifier', PROFESSOR_IDENTIFIER)
          .order('start_time'),
        supabase.from('courses').select('id, name, professor_name'),
      ])

      if (slotsRes.error) {
        setError(slotsRes.error.message)
        setLoading(false)
        return
      }
      if (coursesRes.error) {
        setError(coursesRes.error.message)
        setLoading(false)
        return
      }

      setSlots(slotsRes.data ?? [])
      setCourses(coursesRes.data ?? [])
      setLoading(false)
    }

    loadData()
  }, [])

  async function handleSlotClick(slot) {
    setResolvingSlotId(slot.id)
    setToast('')

    const course = courses.find((c) => courseShortCode(c.name) === slot.course_name)
    if (!course) {
      setResolvingSlotId(null)
      setToast('No matching course found for this class.')
      return
    }

    const targetDate = dateForDayInWeekOf(getTodayISTDateString(), slot.day_of_week)

    const { data, error: sessionError } = await supabase
      .from('sessions')
      .select('id')
      .eq('course_id', course.id)
      .eq('session_date', targetDate)
      .maybeSingle()

    setResolvingSlotId(null)

    if (sessionError || !data) {
      setToast('No session has been generated yet for this class this week — ask the admin to generate upcoming sessions.')
      return
    }

    navigate(`/professor/live/${data.id}`)
  }

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

  const slotsByDay = DAYS.reduce((acc, day) => {
    acc[day] = slots.filter((s) => s.day_of_week === day)
    return acc
  }, {})

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
                Weekly Schedule
              </h1>
            </div>
          </div>
          <UserMenu />
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-7">
        {DAYS.map((day, i) => {
          const isToday = day === today
          return (
            <div
              key={day}
              className={`rounded-xl p-4 shadow-sm ${
                isToday ? 'bg-maroon-50 ring-2 ring-maroon-200' : 'bg-white'
              } ${i > 0 ? 'sm:border-l sm:border-gray-100 lg:border-l' : ''}`}
            >
              <h2
                className={`mb-3 text-xs font-semibold tracking-wide uppercase ${
                  isToday ? 'text-maroon-700' : 'text-gray-500'
                }`}
              >
                {day}
                {isToday && <span className="ml-1 font-normal">· Today</span>}
              </h2>

              <div className="space-y-2">
                {slotsByDay[day].length === 0 && (
                  <p className="text-xs text-gray-400">No classes</p>
                )}

                {slotsByDay[day].map((slot) =>
                  slot.is_functional ? (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => handleSlotClick(slot)}
                      disabled={resolvingSlotId === slot.id}
                      className="block w-full cursor-pointer rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-maroon-300 hover:shadow-md disabled:cursor-wait disabled:opacity-60"
                    >
                      <SlotCardContent
                        slot={slot}
                        otherLabel={otherCourseLabel(slot, courses)}
                        badge={
                          resolvingSlotId === slot.id && (
                            <span className="shrink-0 text-[10px] font-medium text-gray-400">
                              Finding…
                            </span>
                          )
                        }
                      />
                    </button>
                  ) : (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => setToast('Not enabled for this prototype demo')}
                      className="block w-full rounded-lg border border-gray-100 bg-gray-50 p-3 text-left"
                    >
                      <SlotCardContent
                        slot={slot}
                        muted
                        otherLabel={otherCourseLabel(slot, courses)}
                        badge={
                          <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            Demo only
                          </span>
                        }
                      />
                    </button>
                  ),
                )}
              </div>
            </div>
          )
        })}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </PageShell>
  )
}

function SlotCardContent({ slot, muted, otherLabel, badge }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-medium tabular-nums ${muted ? 'text-gray-400' : 'text-gray-500'}`}>
          {formatTimeRange(slot.start_time, slot.end_time)}
        </p>
        {badge}
      </div>
      <p className={`mt-1 text-sm font-semibold ${muted ? 'text-gray-500' : 'text-gray-900'}`}>
        {slot.course_name} · {slot.section}
      </p>
      {otherLabel && (
        <p className="mt-0.5 inline-flex rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
          {otherLabel}
        </p>
      )}
      <p className={`text-xs ${muted ? 'text-gray-400' : 'text-gray-500'}`}>{slot.room}</p>
    </>
  )
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">{children}</div>
    </div>
  )
}

function Card({ children }) {
  return <div className="rounded-xl bg-white p-6 shadow-md sm:p-8">{children}</div>
}
