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
