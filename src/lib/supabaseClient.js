import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// PostgREST caps a single response at a default row limit (1000 on this project) — a query
// scoped to "every attendance record across all of a course's sessions" can quietly exceed that
// once enough sessions have real attendance (e.g. 20 sessions x ~68 students), and without an
// explicit order the rows that get silently dropped aren't even consistent between two
// otherwise-identical requests. buildQuery must return a *fresh* query each call (so a plain
// function, not a pre-built query object) with its own .order() already applied, so paging is
// well-defined across requests.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  let allRows = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    allRows = allRows.concat(data ?? [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return { data: allRows, error: null }
}
