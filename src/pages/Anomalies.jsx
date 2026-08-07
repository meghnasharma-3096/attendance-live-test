import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { buildProfessorScopeOptions, resolveProfessorScope } from '../lib/anomalyScope.js'
import AnomalyReport from '../components/AnomalyReport.jsx'

export default function Anomalies() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [courses, setCourses] = useState([])
  const [scopeOptions, setScopeOptions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadScope() {
      // Same fix as the calendar: this professor's real courses are derived strictly from
      // timetable_slots tagged with their own identifier, never every course in the system.
      const [coursesRes, slotsRes] = await Promise.all([
        supabase.from('courses').select('id, name'),
        supabase
          .from('timetable_slots')
          .select('course_name, section, is_functional')
          .eq('professor_identifier', user.identifier),
      ])

      if (coursesRes.error) {
        setError(coursesRes.error.message)
        setLoading(false)
        return
      }
      if (slotsRes.error) {
        setError(slotsRes.error.message)
        setLoading(false)
        return
      }

      setCourses(coursesRes.data ?? [])
      setScopeOptions(buildProfessorScopeOptions(coursesRes.data ?? [], slotsRes.data ?? []))
      setLoading(false)
    }

    loadScope()
  }, [user.identifier])

  return (
    <PageShell>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-maroon-600">Professor Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Anomaly Detection</h1>
          </div>
          <Link
            to="/professor"
            className="mt-1 shrink-0 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            ← Back
          </Link>
        </div>

        {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
      </Card>

      {scopeOptions &&
        (() => {
          const { courseIds, label } = resolveProfessorScope(searchParams.get('scope'), scopeOptions)
          return <AnomalyReport courses={courses} courseIds={courseIds} scopeLabel={label} />
        })()}
    </PageShell>
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
