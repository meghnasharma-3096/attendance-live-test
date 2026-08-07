import { courseSectionSuffix, findCourseForSlot } from './csv.js'

// Groups a professor's real timetable_slots into Anomaly Detection scope options: one
// "subject" per distinct short code they teach — including non-functional ones like ITC,
// which correctly resolves to zero real course ids and so always reports no anomalies, per
// design — and one "section" per real course row they teach (functional slots only, since a
// non-functional subject has no course row to scope a section to).
export function buildProfessorScopeOptions(courses, slots) {
  const subjectCourseIds = new Map() // course_name -> Set(courseId)
  const sectionLabels = new Map() // courseId -> label

  for (const slot of slots) {
    if (!subjectCourseIds.has(slot.course_name)) subjectCourseIds.set(slot.course_name, new Set())
    if (!slot.is_functional) continue

    const course = findCourseForSlot(courses, slot)
    if (!course) continue

    subjectCourseIds.get(slot.course_name).add(course.id)
    if (!sectionLabels.has(course.id)) {
      const suffix = courseSectionSuffix(course.name)
      sectionLabels.set(course.id, suffix ? `${slot.course_name} · ${suffix}` : slot.course_name)
    }
  }

  const subjects = [...subjectCourseIds.entries()]
    .map(([shortCode, ids]) => ({ shortCode, courseIds: [...ids] }))
    .sort((a, b) => a.shortCode.localeCompare(b.shortCode))

  const sections = [...sectionLabels.entries()]
    .map(([courseId, label]) => ({ courseId, label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const allCourseIds = subjects.flatMap((s) => s.courseIds)

  return { subjects, sections, allCourseIds }
}

export function encodeSubjectScope(shortCode) {
  return `subject:${shortCode}`
}

export function encodeSectionScope(courseId) {
  return `course:${courseId}`
}

// Interprets a scope string (from the Anomaly Detection URL) against this professor's own
// scope options — never against the whole system — so a professor can never widen their view
// beyond courses they actually teach by hand-editing the URL.
export function resolveProfessorScope(scopeParam, { subjects, sections, allCourseIds }) {
  if (!scopeParam || scopeParam === 'all') {
    return { courseIds: allCourseIds, label: 'All my courses' }
  }
  if (scopeParam.startsWith('subject:')) {
    const shortCode = scopeParam.slice('subject:'.length)
    const subject = subjects.find((s) => s.shortCode === shortCode)
    return { courseIds: subject ? subject.courseIds : [], label: shortCode }
  }
  if (scopeParam.startsWith('course:')) {
    const courseId = scopeParam.slice('course:'.length)
    const section = sections.find((s) => s.courseId === courseId)
    return { courseIds: [courseId], label: section ? section.label : 'Selected section' }
  }
  return { courseIds: allCourseIds, label: 'All my courses' }
}
