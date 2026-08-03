import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { getTodayISTDayAbbrev } from '../lib/dateFormat.js'
import UserMenu from '../components/UserMenu.jsx'

const PROFESSOR_IDENTIFIER = 'prof_dtai'
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatTimeRange(startTime, endTime) {
  return `${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`
}

export default function Professor() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [slots, setSlots] = useState([])
  const [toast, setToast] = useState('')

  const today = getTodayISTDayAbbrev()

  useEffect(() => {
    async function loadSlots() {
      setLoading(true)
      setError('')

      const { data, error: slotsError } = await supabase
        .from('timetable_slots')
        .select('id, day_of_week, start_time, end_time, course_name, section, room, is_functional, linked_session_id')
        .eq('professor_identifier', PROFESSOR_IDENTIFIER)
        .order('start_time')

      if (slotsError) {
        setError(slotsError.message)
        setLoading(false)
        return
      }

      setSlots(data ?? [])
      setLoading(false)
    }

    loadSlots()
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
                    <Link
                      key={slot.id}
                      to={`/professor/live/${slot.linked_session_id}`}
                      className="block cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-maroon-300 hover:shadow-md"
                    >
                      <SlotCardContent slot={slot} />
                    </Link>
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

function SlotCardContent({ slot, muted, badge }) {
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
