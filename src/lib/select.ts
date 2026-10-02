import type { Allocation, Person, Project, Settings, Task } from './types'
import { allocationId, type PersonType } from './types'
import { isWorkingDay } from './dates'

export interface Filters {
  projectId: string
  discipline: string
  leadId: string
  type: '' | PersonType
  search: string
  showInactive: boolean
  groupBy: 'none' | 'discipline' | 'lead'
}

export const DEFAULT_FILTERS: Filters = { projectId: '', discipline: '', leadId: '', type: '', search: '', showInactive: false, groupBy: 'discipline' }

export function filterPeople(people: Person[], f: Filters, allocations: Record<string, Allocation>, days: string[]): Person[] {
  const q = f.search.trim().toLowerCase()
  return people.filter((p) => {
    if (!f.showInactive && !p.active) return false
    if (f.discipline && p.discipline !== f.discipline) return false
    if (f.leadId && p.leadId !== f.leadId && p.id !== f.leadId) return false
    if (f.type && p.type !== f.type) return false
    if (q && !`${p.name} ${p.title} ${p.discipline}`.toLowerCase().includes(q)) return false
    if (f.projectId) {
      const hit = days.some((d) => allocations[allocationId(p.id, d)]?.projectId === f.projectId)
      if (!hit) return false
    }
    return true
  })
}

export interface Group { key: string; label: string; people: Person[] }

export function groupPeople(people: Person[], all: Person[], f: Filters, settings: Settings): Group[] {
  if (f.groupBy === 'none') return [{ key: 'all', label: '', people }]
  if (f.groupBy === 'discipline') {
    const order = settings.disciplines
    const map = new Map<string, Person[]>()
    for (const p of people) {
      const k = p.discipline || 'Unassigned'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(p)
    }
    return [...map.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0])
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a[0].localeCompare(b[0])
      })
      .map(([k, ps]) => ({ key: k, label: k, people: ps }))
  }
  // by lead: lead first, then their people; people without a lead at the end
  const leads = all.filter((l) => all.some((p) => p.leadId === l.id))
  const used = new Set<string>()
  const groups: Group[] = []
  for (const lead of leads) {
    const members = people.filter((p) => p.leadId === lead.id || p.id === lead.id)
    if (!members.length) continue
    members.sort((a, b) => (a.id === lead.id ? -1 : b.id === lead.id ? 1 : a.order - b.order))
    members.forEach((m) => used.add(m.id))
    groups.push({ key: lead.id, label: `${lead.name}'s team`, people: members })
  }
  const rest = people.filter((p) => !used.has(p.id))
  if (rest.length) groups.push({ key: 'none', label: leads.length ? 'No team lead' : '', people: rest })
  return groups
}

export function utilisation(personId: string, days: string[], allocations: Record<string, Allocation>, settings: Settings) {
  const working = days.filter((d) => isWorkingDay(d, settings))
  const used = working.filter((d) => allocations[allocationId(personId, d)]).length
  return { used, total: working.length }
}

export function projectTotals(projects: Project[], days: string[], allocations: Record<string, Allocation>, personIds: Set<string>) {
  const totals = new Map<string, number[]>()
  for (const p of projects) totals.set(p.id, days.map(() => 0))
  for (const a of Object.values(allocations)) {
    if (!personIds.has(a.personId)) continue
    const i = days.indexOf(a.date)
    if (i === -1) continue
    const row = totals.get(a.projectId)
    if (row) row[i]++
  }
  return totals
}

export function taskLabel(t: Task | undefined, p: Project | undefined) {
  if (!t) return 'Unknown task'
  return `${p?.code ? p.code + ' · ' : ''}${t.name}`
}
