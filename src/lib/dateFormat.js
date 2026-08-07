const IST_TIME_ZONE = 'Asia/Kolkata'

export function getTodayISTDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST_TIME_ZONE })
}

export function getTodayISTDayAbbrev() {
  return new Date().toLocaleDateString('en-US', { timeZone: IST_TIME_ZONE, weekday: 'short' })
}

export function formatDateIST(dateString) {
  return new Date(dateString).toLocaleDateString('en-IN', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return null
  return `${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`
}

export function formatDateTimeIST(timestamp) {
  return new Date(timestamp).toLocaleString('en-IN', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const DAY_ABBREVS_BY_UTC_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function daysInMonth(year, monthIndex) {
  // Day 0 of the next month is the last day of this one — a standard trick, safe under UTC.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function addDaysToDateString(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function dayAbbrevForDateString(dateString) {
  const [y, m, d] = dateString.split('-').map(Number)
  return DAY_ABBREVS_BY_UTC_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// Smallest date strictly after `afterDateString` whose weekday matches dayAbbrev.
export function nextOccurrenceOfDay(afterDateString, dayAbbrev) {
  let candidate = addDaysToDateString(afterDateString, 1)
  while (dayAbbrevForDateString(candidate) !== dayAbbrev) {
    candidate = addDaysToDateString(candidate, 1)
  }
  return candidate
}

// The date of dayAbbrev within the Mon–Sun week that contains referenceDateString.
export function dateForDayInWeekOf(referenceDateString, dayAbbrev) {
  const refIndex = WEEK_ORDER.indexOf(dayAbbrevForDateString(referenceDateString))
  const targetIndex = WEEK_ORDER.indexOf(dayAbbrev)
  const mondayOfWeek = addDaysToDateString(referenceDateString, -refIndex)
  return addDaysToDateString(mondayOfWeek, targetIndex)
}
