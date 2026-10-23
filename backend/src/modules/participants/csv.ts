import { AppError } from '../../errors'

export function parseParticipantCsv(text: string): Array<Record<string, string>> {
  const source = text.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++ }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field.length === 0) quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++
      row.push(field); records.push(row); row = []; field = ''
    } else field += char
  }
  if (quoted) throw new AppError(400, 'CSV contains an unclosed quoted field')
  if (field.length || row.length) { row.push(field); records.push(row) }
  const nonEmpty = records.filter(record => record.some(value => value.trim() !== ''))
  if (!nonEmpty.length) throw new AppError(400, 'CSV must include a header row')
  const headers = nonEmpty[0].map(value => value.trim().toLowerCase())
  if (!headers.includes('name') || !headers.includes('email')) {
    throw new AppError(400, 'CSV headers must include name and email; external_id is optional')
  }
  if (new Set(headers).size !== headers.length) throw new AppError(400, 'CSV headers must be unique')
  return nonEmpty.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}
