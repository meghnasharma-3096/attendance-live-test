export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Precedence: the professor's own global setting wins whenever they've set one (non-zero),
// otherwise the course's admin-set default, otherwise the feature is off (0). Applied per
// field independently — a professor who's only customized their pre-class grace still gets
// the course's own post-class default, rather than having it silently zeroed out too.
export function effectiveGraceMinutes(professorGrace, course) {
  const professorBefore = professorGrace?.grace_period_before_minutes ?? 0
  const professorAfter = professorGrace?.grace_period_after_minutes ?? 0
  const courseBefore = course?.grace_period_before_minutes ?? 0
  const courseAfter = course?.grace_period_after_minutes ?? 0

  return {
    before: professorBefore !== 0 ? professorBefore : courseBefore,
    after: professorAfter !== 0 ? professorAfter : courseAfter,
  }
}

// Pure time-of-day/date classification, independent of session.status (matching the
// calendar's long-standing convention). graceBeforeMinutes/graceAfterMinutes extend the
// "beginning soon"/"grace period" windows around start_time/end_time and both default to 0,
// so a session with no grace configured collapses back to the original two-state (pending →
// past-at-end_time) behavior exactly as before this feature existed.
export function sessionTimeState(session, todayString, nowTimeString, graceBeforeMinutes = 0, graceAfterMinutes = 0) {
  const { session_date, start_time, end_time } = session

  if (session_date > todayString) return 'future'
  if (session_date < todayString) return 'past'
  if (!start_time || !end_time) return 'today-pending'

  const nowMin = timeToMinutes(nowTimeString)
  const startMin = timeToMinutes(start_time)
  const endMin = timeToMinutes(end_time)

  if (nowMin >= startMin && nowMin <= endMin) return 'ongoing'
  if (nowMin < startMin) {
    return nowMin >= startMin - graceBeforeMinutes ? 'beginning-soon' : 'today-pending'
  }
  return nowMin <= endMin + graceAfterMinutes ? 'grace-period' : 'today-past'
}

// 'today-past' still needs one more fork: a session whose window (plus grace) has fully
// closed today with zero real attendance is "missed", but one that was properly run keeps
// the same after-the-fact QR/manual coloring any other past session gets — it just happens
// to be today rather than an earlier date.
export function resolveTodayPastState(timeState, hasAttendance) {
  if (timeState !== 'today-past') return timeState
  return hasAttendance ? 'past' : 'attendance-missed'
}
