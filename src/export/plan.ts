import type { Allocation, Person, Project, Settings, Task } from '../lib/types'
import { allocationId } from '../lib/types'
import { chunkByWeek, consecutiveRuns, fmtRange, isWorkingDay, rangeKeys } from '../lib/dates'
import { groupPeople, projectTotals, type Filters, type Group } from '../lib/select'

export const AUTHOR = 'Motasem Albanna'
export const FONT = 'Aptos'

export interface PlanOptions {
  title: string
  start: string
  end: string
  includeNonWorking: boolean
  filters: Filters
}

export interface ByProject {
  project: Project
  tasks: { task: Task; people: { person: Person; runs: string[][]; days: number }[] }[]
}

export interface PlanData extends PlanOptions {
  orgName: string
  days: string[]
  weeks: string[][]
  people: Person[]
  groups: Group[]
  projects: Project[]
  tasks: Task[]
  allocations: Record<string, Allocation>
  settings: Settings
  byProject: ByProject[]
  totals: Map<string, number[]>
  generatedBy: string
  generatedAt: Date
  periodLabel: string
  cell: (personId: string, date: string) => { alloc: Allocation; project?: Project; task?: Task } | null
}

export function buildPlan(
  opts: PlanOptions,
  src: { people: Person[]; projects: Project[]; tasks: Task[]; allocations: Allocation[]; settings: Settings; generatedBy: string },
): PlanData {
  const allDays = rangeKeys(opts.start, opts.end)
  const days = opts.includeNonWorking ? allDays : allDays.filter((d) => isWorkingDay(d, src.settings))
  const allocations: Record<string, Allocation> = {}
  for (const a of src.allocations) allocations[a.id] = a
  const projectMap = new Map(src.projects.map((p) => [p.id, p]))
  const taskMap = new Map(src.tasks.map((t) => [t.id, t]))

  const f = opts.filters
  const q = f.search.trim().toLowerCase()
  const people = src.people.filter((p) => {
    if (!f.showInactive && !p.active) return false
    if (f.discipline && p.discipline !== f.discipline) return false
    if (f.leadId && p.leadId !== f.leadId && p.id !== f.leadId) return false
    if (f.type && p.type !== f.type) return false
    if (q && !`${p.name} ${p.title} ${p.discipline}`.toLowerCase().includes(q)) return false
    if (f.projectId && !days.some((d) => allocations[allocationId(p.id, d)]?.projectId === f.projectId)) return false
    return true
  })
  const groups = groupPeople(people, src.people, f, src.settings)
  const personIds = new Set(people.map((p) => p.id))
  const totals = projectTotals(src.projects, days, allocations, personIds)

  // by project -> task -> person -> runs
  const byProject: ByProject[] = []
  for (const project of src.projects) {
    if (f.projectId && project.id !== f.projectId) continue
    const taskEntries: ByProject['tasks'] = []
    for (const task of src.tasks.filter((t) => t.projectId === project.id)) {
      const perPerson = new Map<string, string[]>()
      for (const d of days) {
        for (const p of people) {
          const a = allocations[allocationId(p.id, d)]
          if (a && a.taskId === task.id) (perPerson.get(p.id) ?? perPerson.set(p.id, []).get(p.id)!).push(d)
        }
      }
      if (!perPerson.size) continue
      taskEntries.push({
        task,
        people: [...perPerson.entries()].map(([pid, ds]) => ({ person: people.find((p) => p.id === pid)!, runs: consecutiveRuns(ds), days: ds.length })),
      })
    }
    if (taskEntries.length) byProject.push({ project, tasks: taskEntries })
  }

  return {
    ...opts,
    orgName: src.settings.orgName,
    days,
    weeks: chunkByWeek(days, src.settings),
    people,
    groups,
    projects: src.projects,
    tasks: src.tasks,
    allocations,
    settings: src.settings,
    byProject,
    totals,
    generatedBy: src.generatedBy,
    generatedAt: new Date(),
    periodLabel: fmtRange(opts.start, opts.end),
    cell: (personId, date) => {
      const alloc = allocations[allocationId(personId, date)]
      if (!alloc) return null
      return { alloc, project: projectMap.get(alloc.projectId), task: taskMap.get(alloc.taskId) }
    },
  }
}

/** Plain text summary for WhatsApp / Teams / email. */
export function planToText(plan: PlanData): string {
  const lines: string[] = [`${plan.title}`, `${plan.periodLabel}`, '']
  for (const g of plan.groups) {
    if (g.label) lines.push(`== ${g.label} ==`)
    for (const p of g.people) {
      const perTask = new Map<string, string[]>()
      for (const d of plan.days) {
        const c = plan.cell(p.id, d)
        if (!c) continue
        const k = `${c.project?.code ?? ''} ${c.task?.name ?? ''}`.trim()
        ;(perTask.get(k) ?? perTask.set(k, []).get(k)!).push(d)
      }
      if (!perTask.size) { lines.push(`${p.name}: not allocated`); continue }
      const parts = [...perTask.entries()].map(([k, ds]) => `${k} (${consecutiveRuns(ds).map((r) => (r.length === 1 ? short(r[0]) : `${short(r[0])}-${short(r[r.length - 1])}`)).join(', ')})`)
      lines.push(`${p.name}: ${parts.join('; ')}`)
    }
    lines.push('')
  }
  lines.push(`Prepared by ${plan.generatedBy}`)
  return lines.join('\n')
}

function short(key: string) {
  const [, m, d] = key.split('-')
  return `${Number(d)}/${Number(m)}`
}

export function fileStem(plan: PlanData) {
  return `${plan.orgName.replace(/[^\w]+/g, '_')}_Allocation_${plan.start}_to_${plan.end}`
}
