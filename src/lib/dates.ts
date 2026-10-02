import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek, isValid } from 'date-fns'
import type { Settings } from './types'

export const toKey = (d: Date) => format(d, 'yyyy-MM-dd')
export const fromKey = (k: string) => parseISO(k)
export const todayKey = () => toKey(new Date())

export function isValidKey(k: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(k) && isValid(parseISO(k))
}

export function rangeKeys(startKey: string, endKey: string): string[] {
  const start = fromKey(startKey)
  const n = differenceInCalendarDays(fromKey(endKey), start)
  if (n < 0) return []
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(toKey(addDays(start, i)))
  return out
}

export function isWorkingDay(key: string, settings: Settings) {
  const d = fromKey(key)
  if (!settings.workingDays.includes(d.getDay())) return false
  if (settings.holidays.includes(key)) return false
  return true
}

export function isHoliday(key: string, settings: Settings) {
  return settings.holidays.includes(key)
}

/** First day of the week that contains `key`, using the first working day as week start. */
export function weekStartKey(key: string, settings: Settings) {
  const first = (settings.workingDays.length ? Math.min(...settings.workingDays) : 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  return toKey(startOfWeek(fromKey(key), { weekStartsOn: first }))
}

export function shiftKey(key: string, days: number) {
  return toKey(addDays(fromKey(key), days))
}

export const fmtDay = (key: string) => format(fromKey(key), 'EEE')
export const fmtDayNum = (key: string) => format(fromKey(key), 'd')
export const fmtShort = (key: string) => format(fromKey(key), 'd MMM')
export const fmtLong = (key: string) => format(fromKey(key), 'EEEE d MMMM yyyy')
export const fmtMonth = (key: string) => format(fromKey(key), 'MMM yyyy')
export const fmtRange = (a: string, b: string) => `${format(fromKey(a), 'd MMM yyyy')} to ${format(fromKey(b), 'd MMM yyyy')}`

/** Group consecutive dates into runs: [[d1,d2,d3],[d7,d8]] */
export function consecutiveRuns(keys: string[]): string[][] {
  const sorted = [...keys].sort()
  const runs: string[][] = []
  for (const k of sorted) {
    const last = runs[runs.length - 1]
    if (last && shiftKey(last[last.length - 1], 1) === k) last.push(k)
    else runs.push([k])
  }
  return runs
}

/** Split a list of date keys into weeks (arrays), starting at the configured week start. */
export function chunkByWeek(keys: string[], settings: Settings): string[][] {
  const weeks: string[][] = []
  let current: string[] = []
  let currentStart = ''
  for (const k of keys) {
    const ws = weekStartKey(k, settings)
    if (ws !== currentStart) {
      if (current.length) weeks.push(current)
      current = []
      currentStart = ws
    }
    current.push(k)
  }
  if (current.length) weeks.push(current)
  return weeks
}
