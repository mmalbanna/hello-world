import type { Allocation, Settings, Task } from './types'
import { isWorkingDay, rangeKeys } from './dates'

export type Health = 'not_started' | 'on_track' | 'at_risk' | 'delayed' | 'on_hold' | 'done'

export const HEALTH: Record<Health, { label: string; color: string; bg: string; text: string }> = {
  not_started: { label: 'Not started', color: '#94a3b8', bg: '#f1f5f9', text: '#475569' },
  on_track: { label: 'On track', color: '#16a34a', bg: '#dcfce7', text: '#166534' },
  at_risk: { label: 'At risk', color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  delayed: { label: 'Delayed', color: '#dc2626', bg: '#fee2e2', text: '#991b1b' },
  on_hold: { label: 'Interrupted', color: '#7c3aed', bg: '#ede9fe', text: '#5b21b6' },
  done: { label: 'Done', color: '#2563eb', bg: '#dbeafe', text: '#1e40af' },
}

export function workingDaysBetween(a: string, b: string, settings: Settings) {
  if (!a || !b || b < a) return 0
  return rangeKeys(a, b).filter((d) => isWorkingDay(d, settings)).length
}

/** Expected progress at `date` from the plan: time elapsed in the planned window, or effort spent vs planned effort. */
export function plannedPercent(task: Task, date: string, settings: Settings, effortToDate: number): number | null {
  if (task.startDate && task.endDate) {
    const total = workingDaysBetween(task.startDate, task.endDate, settings)
    if (!total) return date >= task.endDate ? 100 : 0
    if (date < task.startDate) return 0
    if (date > task.endDate) return 100
    const elapsed = workingDaysBetween(task.startDate, date, settings)
    return Math.round((elapsed / total) * 100)
  }
  if (task.plannedDays && task.plannedDays > 0) return Math.min(100, Math.round((effortToDate / task.plannedDays) * 100))
  return null
}

export function taskHealth(task: Task, date: string, plannedPct: number | null, effortToDate: number): Health {
  if (task.status === 'done') return 'done'
  if (task.status === 'on_hold') return 'on_hold'
  const started = task.status === 'in_progress' || effortToDate > 0 || task.progress > 0 || !!task.actualStart
  if (!started) {
    if (task.startDate && task.startDate < date) return 'delayed' // should have started
    return 'not_started'
  }
  if (task.endDate && task.endDate < date && task.progress < 100) return 'delayed'
  if (plannedPct === null) return 'on_track'
  const gap = plannedPct - task.progress
  if (gap > 30) return 'delayed'
  if (gap > 12) return 'at_risk'
  return 'on_track'
}

/** Person-days allocated to the task up to and including `date` (within the loaded allocations). */
export function effortToDate(taskId: string, date: string, allocations: Record<string, Allocation> | Allocation[]) {
  const list = Array.isArray(allocations) ? allocations : Object.values(allocations)
  return list.filter((a) => a.taskId === taskId && a.date <= date).length
}

export function effortTotal(taskId: string, allocations: Record<string, Allocation> | Allocation[]) {
  const list = Array.isArray(allocations) ? allocations : Object.values(allocations)
  return list.filter((a) => a.taskId === taskId).length
}

export interface TaskStatusView {
  plannedPct: number | null
  actualPct: number
  health: Health
  effortToDate: number
  effortTotal: number
  peopleToday: string[]
}

export function taskStatusView(task: Task, date: string, settings: Settings, allocations: Record<string, Allocation>): TaskStatusView {
  const list = Object.values(allocations).filter((a) => a.taskId === task.id)
  const eff = list.filter((a) => a.date <= date).length
  const plannedPct = plannedPercent(task, date, settings, eff)
  return {
    plannedPct,
    actualPct: task.status === 'done' ? 100 : task.progress ?? 0,
    health: taskHealth(task, date, plannedPct, eff),
    effortToDate: eff,
    effortTotal: list.length,
    peopleToday: list.filter((a) => a.date === date).map((a) => a.personId),
  }
}

const DISCIPLINE_PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#0d9488']

export function disciplineColor(discipline: string, settings: Settings) {
  const i = settings.disciplines.indexOf(discipline)
  if (i === -1) return '#64748b'
  return DISCIPLINE_PALETTE[i % DISCIPLINE_PALETTE.length]
}

/** First working day on or after `key`. */
export function nextWorkingDay(key: string, settings: Settings) {
  let k = key
  for (let i = 0; i < 14; i++) {
    if (isWorkingDay(k, settings)) return k
    const d = new Date(k); d.setDate(d.getDate() + 1); k = d.toISOString().slice(0, 10)
  }
  return key
}

/** Adds n working days to `key` (n >= 0) and returns the resulting key. */
export function addWorkingDays(key: string, n: number, settings: Settings) {
  let k = key; let count = 0
  while (count < n) {
    const d = new Date(k); d.setDate(d.getDate() + 1); k = d.toISOString().slice(0, 10)
    if (isWorkingDay(k, settings)) count++
  }
  return k
}
