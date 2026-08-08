function toCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(toCsvValue).join(',')).join('\r\n')
}

// Inverts rowsToCsv/toCsvValue above — handles quoted fields containing commas, quotes
// (escaped as ""), and embedded newlines, so a file downloaded from this app's own export
// and re-uploaded unmodified round-trips exactly.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const STOPWORDS = new Set(['and', 'of', 'the', 'for', 'in', 'a', 'an'])

export function courseShortCode(courseName) {
  const mainPart = courseName.split(/[—-]/)[0].trim()
  const words = mainPart.split(/\s+/).filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()))
  const code = words.map((w) => w[0].toUpperCase()).join('')
  return code || 'COURSE'
}

// The "— Section A" / "— Section B" suffix a course name may carry, converted to the
// abbreviated form timetable_slots.section actually stores ("Sec A"). Null for course names
// with no such suffix (e.g. single-section courses like BDC/SOM) — there's nothing to
// disambiguate for those.
export function courseSectionSuffix(courseName) {
  const parts = courseName.split(/[—-]/)
  if (parts.length < 2) return null
  return parts[1].trim().replace(/^Section\s+/i, 'Sec ')
}

// timetable_slots.course_name is a short-code text field, not a foreign key — once two
// courses share a short code (e.g. DTAI Section A and Section B), matching on short code alone
// is ambiguous. Short-code match first; only fall back to the section suffix when more than one
// course shares that short code, so single-section courses (no suffix to compare) still resolve
// correctly without requiring one.
export function findCourseForSlot(courses, slot) {
  const shortCodeMatches = courses.filter((c) => courseShortCode(c.name) === slot.course_name)
  if (shortCodeMatches.length <= 1) return shortCodeMatches[0] ?? null
  return shortCodeMatches.find((c) => courseSectionSuffix(c.name) === slot.section) ?? null
}
