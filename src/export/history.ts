import { Timestamp } from 'firebase/firestore'
import type { Allocation, Loan, Person, PlanEvent, Project, Settings, Task } from '../lib/types'
import { EVENT_LABEL, REASONS } from '../lib/types'
import { consecutiveRuns, fmtRange, fmtShort, isWorkingDay, rangeKeys, toKey } from '../lib/dates'
import { HEALTH, taskHealth, plannedPercent } from '../lib/progress'
import type { ReportDoc } from './report'

export interface HistorySource {
  start: string
  end: string
  people: Person[]
  projects: Project[]
  tasks: Task[]
  allocations: Allocation[]
  events: PlanEvent[]
  loans: Loan[]
  settings: Settings
  generatedBy: string
  projectFilter?: string
}

export function buildHistoryReport(src: HistorySource): ReportDoc {
  const pById = new Map(src.people.map((p) => [p.id, p]))
  const prById = new Map(src.projects.map((p) => [p.id, p]))
  const tById = new Map(src.tasks.map((t) => [t.id, t]))
  const pf = src.projectFilter
  const tasks = src.tasks.filter((t) => !pf || t.projectId === pf)
  const allocs = src.allocations.filter((a) => !pf || a.projectId === pf)
  const events = src.events.filter((e) => !pf || e.projectId === pf)
  const createdOn = (l: Loan) => (l.createdAt instanceof Timestamp ? toKey(l.createdAt.toDate()) : l.startDate)
  // loans created in the period, or running during it
  const loans = src.loans.filter((l) => (!pf || l.fromProjectId === pf || l.toProjectId === pf) && ((createdOn(l) >= src.start && createdOn(l) <= src.end) || (l.startDate <= src.end && (l.actualReturn ?? l.plannedReturn) >= src.start)))
  const name = (id: string | null | undefined) => (id ? pById.get(id)?.name ?? '?' : '')
  const taskName = (id: string | null | undefined) => (id ? tById.get(id)?.name ?? '?' : '')
  const code = (id: string | null | undefined) => (id ? prById.get(id)?.code ?? '' : '')
  const color = (id: string | null | undefined) => (id ? prById.get(id)?.color ?? null : null)
  const days = rangeKeys(src.start, src.end).filter((d) => isWorkingDay(d, src.settings))

  // ---- per task metrics
  const effortByTask = new Map<string, number>()
  const effortToEnd = new Map<string, number>()
  for (const a of src.allocations) {
    effortByTask.set(a.taskId, (effortByTask.get(a.taskId) ?? 0) + (a.date >= src.start && a.date <= src.end ? 1 : 0))
    if (a.date <= src.end) effortToEnd.set(a.taskId, (effortToEnd.get(a.taskId) ?? 0) + 1)
  }
  const replans = new Map<string, number>(); const interrupts = new Map<string, number>()
  for (const e of events) {
    if (e.taskId && e.kind === 'task_replanned') replans.set(e.taskId, (replans.get(e.taskId) ?? 0) + 1)
    if (e.taskId && e.kind === 'task_interrupted') interrupts.set(e.taskId, (interrupts.get(e.taskId) ?? 0) + 1)
  }
  const activeTasks = tasks.filter((t) => (effortByTask.get(t.id) ?? 0) > 0 || events.some((e) => e.taskId === t.id) || (t.status !== 'done' && t.status !== 'open'))
  const taskRows = activeTasks.map((t) => {
    const eff = effortToEnd.get(t.id) ?? 0
    const planned = plannedPercent(t, src.end, src.settings, eff)
    const health = taskHealth(t, src.end, planned, eff)
    return {
      t, planned, health, eff,
      row: [`${code(t.projectId)} ${t.name}`, t.status.replace('_', ' '), t.startDate ?? '', t.endDate ?? '', t.actualStart ?? '', t.actualEnd ?? '', t.plannedDays ?? '', eff, effortByTask.get(t.id) ?? 0, t.progress, planned ?? '', HEALTH[health].label, replans.get(t.id) ?? 0, interrupts.get(t.id) ?? 0],
    }
  })

  // ---- movements: allocation runs per person per task within range
  const runKey = new Map<string, string[]>()
  for (const a of allocs) {
    if (a.date < src.start || a.date > src.end) continue
    const k = `${a.personId}|${a.taskId}`
    ;(runKey.get(k) ?? runKey.set(k, []).get(k)!).push(a.date)
  }
  const movementRows: (string | number)[][] = []; const movementColors: (string | null)[] = []
  for (const [k, ds] of runKey) {
    const [pid, tid] = k.split('|')
    const t = tById.get(tid)
    for (const r of consecutiveRuns(ds)) {
      movementRows.push([name(pid), pById.get(pid)?.discipline ?? '', code(t?.projectId), taskName(tid), fmtShort(r[0]), fmtShort(r[r.length - 1]), r.length])
      movementColors.push(color(t?.projectId))
    }
  }
  movementRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[4]).localeCompare(String(b[4])))

  // mobilisations: first allocation of a person on a project within the range with no allocation on that project in the 10 working days before
  const byPersonProject = new Map<string, string[]>()
  for (const a of src.allocations) { const k = `${a.personId}|${a.projectId}`; (byPersonProject.get(k) ?? byPersonProject.set(k, []).get(k)!).push(a.date) }
  const mobRows: (string | number)[][] = []; const mobColors: (string | null)[] = []
  for (const [k, ds] of byPersonProject) {
    const [pid, prid] = k.split('|')
    if (pf && prid !== pf) continue
    const sorted = [...new Set(ds)].sort()
    const runs = consecutiveRuns(sorted)
    // merge runs separated by short gaps (<= 10 calendar days) into one mobilisation
    const merged: string[][] = []
    for (const r of runs) {
      const last = merged[merged.length - 1]
      if (last && (new Date(r[0]).getTime() - new Date(last[last.length - 1]).getTime()) / 86400000 <= 10) last.push(...r)
      else merged.push([...r])
    }
    for (const m of merged) {
      const s0 = m[0]; const e0 = m[m.length - 1]
      if (e0 < src.start || s0 > src.end) continue
      mobRows.push([name(pid), pById.get(pid)?.discipline ?? '', code(prid), s0 >= src.start ? fmtShort(s0) : `${fmtShort(s0)} (before period)`, e0 <= src.end ? fmtShort(e0) : 'ongoing', m.length])
      mobColors.push(color(prid))
    }
  }
  mobRows.sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])))

  // ---- loans
  const loanRows = loans.map((l) => [name(l.personId), `${code(l.fromProjectId)} ${taskName(l.fromTaskId)}`, `${code(l.toProjectId)} ${taskName(l.toTaskId)}`, fmtShort(l.startDate), fmtShort(l.plannedReturn), l.actualReturn ? fmtShort(l.actualReturn) : '', l.status, REASONS[l.reason] ?? l.reason, l.note, l.createdByName])
  const loanColors = loans.map((l) => color(l.toProjectId))

  // ---- interruptions & delays
  const issueKinds = new Set(['task_interrupted', 'task_resumed', 'task_replanned', 'released', 'loan_started'])
  const issues = events.filter((e) => issueKinds.has(e.kind)).sort((a, b) => a.date.localeCompare(b.date))
  const issueRows = issues.map((e) => [fmtShort(e.date), code(e.projectId), taskName(e.taskId), EVENT_LABEL[e.kind], e.reason ? REASONS[e.reason] ?? e.reason : '', e.kind === 'task_replanned' ? `${e.from ? fmtShort(e.from) : '?'} to ${e.to ? fmtShort(e.to) : '?'}` : e.personId ? name(e.personId) : '', e.note, e.byName])
  const issueColors = issues.map((e) => color(e.projectId))

  // ---- timeline
  const tl = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const tlRows = tl.map((e) => [fmtShort(e.date), EVENT_LABEL[e.kind], code(e.projectId), taskName(e.taskId), name(e.personId), details(e, taskName), e.byName])
  const tlColors = tl.map((e) => color(e.projectId))

  // ---- utilisation
  const utilRows = src.people.filter((p) => p.active).map((p) => {
    const mine = allocs.filter((a) => a.personId === p.id && a.date >= src.start && a.date <= src.end)
    const projects = [...new Set(mine.map((a) => code(a.projectId)))].filter(Boolean).join(', ')
    const loaned = mine.filter((a) => a.loanId).length
    return [p.name, p.discipline, p.type.replace('_', ' '), days.length, mine.length, days.length ? Math.round((mine.length / days.length) * 100) : 0, loaned, projects]
  })

  // ---- progress planned vs actual
  const progRows = activeTasks.filter((t) => t.status !== 'done' || (t.actualEnd ?? '') >= src.start).map((t) => {
    const eff = effortToEnd.get(t.id) ?? 0
    const planned = plannedPercent(t, src.end, src.settings, eff)
    const health = taskHealth(t, src.end, planned, eff)
    return { row: [`${code(t.projectId)} ${t.name}`, planned ?? '', t.progress, planned === null ? '' : t.progress - planned, HEALTH[health].label, t.endDate ?? '', t.plannedDays ?? '', eff], c: color(t.projectId) }
  })

  const completed = events.filter((e) => e.kind === 'task_completed').length
  const started = events.filter((e) => e.kind === 'task_started').length
  const kpis = [
    { label: 'Person-days allocated', value: allocs.filter((a) => a.date >= src.start && a.date <= src.end).length },
    { label: 'Tasks completed', value: completed, color: '#2563eb' },
    { label: 'Tasks started', value: started, color: '#16a34a' },
    { label: 'Interruptions', value: issues.filter((e) => e.kind === 'task_interrupted').length, color: '#7c3aed' },
    { label: 'Finish dates replanned', value: issues.filter((e) => e.kind === 'task_replanned').length, color: '#dc2626' },
    { label: 'Loans between tasks', value: loans.length, color: '#f59e0b' },
    { label: 'Delayed tasks now', value: taskRows.filter((r) => r.health === 'delayed').length, color: '#dc2626' },
    { label: 'At risk now', value: taskRows.filter((r) => r.health === 'at_risk').length, color: '#f59e0b' },
  ]

  return {
    title: 'BIM Delivery History and Progress Report',
    subtitle: `${src.settings.orgName} · ${fmtRange(src.start, src.end)}${pf ? ` · ${code(pf)} ${prById.get(pf)?.name ?? ''}` : ''}`,
    generatedBy: src.generatedBy,
    generatedAt: new Date(),
    kpis,
    sections: [
      { heading: 'Task history', text: 'Every task that was worked on or changed in the period. Planned values come from the task plan, actuals from allocations and progress updates.', table: { columns: ['Task', 'Status', 'Planned start', 'Planned finish', 'Actual start', 'Actual finish', 'Planned pd', 'Actual pd to date', 'pd in period', 'Progress %', 'Planned %', 'Health', 'Replans', 'Interruptions'], rows: taskRows.map((r) => r.row), rowColors: taskRows.map((r) => color(r.t.projectId)), widths: [3, 1, 1.1, 1.1, 1.1, 1.1, 0.8, 0.9, 0.8, 0.8, 0.8, 1, 0.7, 0.9] } },
      { heading: 'Planned vs actual', text: `Snapshot at ${fmtShort(src.end)}. Variance = actual % minus planned %. Negative means behind plan.`, table: { columns: ['Task', 'Planned %', 'Actual %', 'Variance', 'Health', 'Planned finish', 'Planned pd', 'Actual pd'], rows: progRows.map((r) => r.row), rowColors: progRows.map((r) => r.c), widths: [3, 0.8, 0.8, 0.8, 1, 1.1, 0.8, 0.8] } },
      { heading: 'Resource movements', text: 'Who worked on which task and when (continuous blocks).', table: { columns: ['Person', 'Discipline', 'Project', 'Task', 'From', 'To', 'Days'], rows: movementRows, rowColors: movementColors, widths: [1.3, 1, 0.7, 2.5, 0.9, 0.9, 0.6] } },
      { heading: 'Mobilisation', text: 'Periods a person was mobilised on a project (gaps of up to 10 days count as the same mobilisation).', table: { columns: ['Person', 'Discipline', 'Project', 'Mobilised', 'Demobilised', 'Days'], rows: mobRows, rowColors: mobColors, widths: [1.3, 1, 0.8, 1.4, 1.2, 0.6] } },
      { heading: 'Loans between tasks', text: 'Tentative moves of a person to another task with a planned return.', table: { columns: ['Person', 'From', 'To', 'Start', 'Planned return', 'Actual return', 'Status', 'Reason', 'Note', 'By'], rows: loanRows, rowColors: loanColors, widths: [1.1, 2, 2, 0.9, 0.9, 0.9, 0.8, 1.4, 1.6, 1] } },
      { heading: 'Interruptions and delays', text: 'Why tasks were interrupted, replanned or lost people.', table: { columns: ['Date', 'Project', 'Task', 'Event', 'Reason', 'Detail', 'Note', 'By'], rows: issueRows, rowColors: issueColors, widths: [0.8, 0.7, 2.2, 1.2, 1.6, 1.4, 2, 1] } },
      { heading: 'Utilisation', text: 'Allocated working days per person in the period.', table: { columns: ['Person', 'Discipline', 'Type', 'Working days', 'Allocated', 'Utilisation %', 'Days on loan', 'Projects'], rows: utilRows, widths: [1.4, 1, 1, 0.8, 0.8, 0.8, 0.8, 1.6] } },
      { heading: 'Timeline', text: 'All events recorded in the period (the date shown is the effective date, which can be the next working day when planning on a weekend).', table: { columns: ['Date', 'Event', 'Project', 'Task', 'Person', 'Details', 'By'], rows: tlRows, rowColors: tlColors, widths: [0.8, 1.2, 0.7, 2.2, 1.1, 2.2, 1] } },
    ],
  }
}

function details(e: PlanEvent, taskName: (id: string | null) => string) {
  const parts: string[] = []
  if (e.kind === 'progress' && e.progress !== null) parts.push(`${e.progress}%`)
  if (e.kind === 'task_replanned') parts.push(`${e.from ? fmtShort(e.from) : '?'} to ${e.to ? fmtShort(e.to) : '?'}`)
  else if (e.from && e.to) parts.push(e.from === e.to ? fmtShort(e.from) : `${fmtShort(e.from)} to ${fmtShort(e.to)}`)
  if (e.fromTaskId && e.toTaskId && e.fromTaskId !== e.toTaskId) parts.push(`${taskName(e.fromTaskId)} to ${taskName(e.toTaskId)}`)
  if (e.reason) parts.push(REASONS[e.reason] ?? e.reason)
  if (e.note) parts.push(e.note)
  return parts.join(' · ')
}
