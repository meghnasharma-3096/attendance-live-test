const IST_TIME_ZONE = 'Asia/Kolkata'

export function getTodayISTDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST_TIME_ZONE })
}

export function formatDateIST(dateString) {
  return new Date(dateString).toLocaleDateString('en-IN', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
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
