import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { useStore } from '../store/useStore'
import { allocationId, EVENT_LABEL, REASONS, type Person, type PlanEvent, type Task } from '../lib/types'
import { fmtShort, isWorkingDay, rangeKeys, shiftKey, todayKey, toKey } from '../lib/dates'
import { HEALTH, disciplineColor, nextWorkingDay, taskStatusView, type Health } from '../lib/progress'
import { Avatar } from '../components/Avatar'
import { ProgressBar } from '../components/board/TaskCard'
import { Spinner, Empty, Button } from '../components/ui'

const KIND_COLOR: Record<string, string> = {
  task_completed: '#2563eb', task_started: '#16a34a', task_interrupted: '#7c3aed', task_resumed: '#0891b2', task_replanned: '#dc2626', task_created: '#64748b', task_reopened: '#0891b2',
  loan_started: '#f59e0b', loan_returned: '#f59e0b', loan_extended: '#f59e0b', assigned: '#0f4c81', moved: '#0f4c81', released: '#64748b', progress: '#16a34a',
}

export default function Overview() {
  const { people, projects, tasks, allocations, events, loans, settings, loaded } = useStore()
  const today = todayKey()
  const day = nextWorkingDay(today, settings)
  const weekAgo = shiftKey(today, -7)
  const horizon = shiftKey(today, 14)
  const active = useMemo(() => people.filter((p) => p.active), [people])
  const prById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])
  const tById = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks])
  const pById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])

  const views = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, taskStatusView(t, day, settings, allocations)])), [tasks, day, settings, allocations])
  const allocToday = useMemo(() => Object.fromEntries(active.map((p) => [p.id, allocations[allocationId(p.id, day)]])), [active, allocations, day])

  const kpis = useMemo(() => {
    const onTask = active.filter((p) => allocToday[p.id]).length
    const open = tasks.filter((t) => t.status !== 'done')
    const c = (h: Health) => open.filter((t) => views[t.id].health === h).length
    return {
      onTask, free: active.length - onTask, onLoan: active.filter((p) => allocToday[p.id]?.loanId).length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length, atRisk: c('at_risk'), delayed: c('delayed'), onHold: c('on_hold'),
      due: open.filter((t) => t.endDate && t.endDate >= today && t.endDate <= horizon).length,
      backlog: open.filter((t) => t.status === 'open' && !views[t.id].effortTotal).length,
    }
  }, [active, allocToday, tasks, views, today, horizon])

  const happened = useMemo(() => {
    const important = new Set(['task_completed', 'task_started', 'task_interrupted', 'task_resumed', 'task_replanned', 'loan_started', 'loan_returned', 'loan_extended', 'released', 'task_created', 'task_reopened'])
    // "happened" = recorded in the last 7 days (the effective date may be the next working day when planning on a weekend)
    const recordedOn = (e: PlanEvent) => (e.at instanceof Timestamp ? toKey(e.at.toDate()) : today)
    const recent = events.filter((e) => { const r = recordedOn(e); return r >= weekAgo && r <= today })
    const list = recent.filter((e) => important.has(e.kind)).slice(0, 25)
    const progressUpdates = recent.filter((e) => e.kind === 'progress').length
    const moves = recent.filter((e) => e.kind === 'assigned' || e.kind === 'moved').length
    // mobilised: people whose first allocation on a project (in the loaded window) falls in the last 7 days
    const firstOnProject = new Map<string, string>()
    for (const a of Object.values(allocations)) { const k = `${a.personId}|${a.projectId}`; const cur = firstOnProject.get(k); if (!cur || a.date < cur) firstOnProject.set(k, a.date) }
    const mobilised = [...firstOnProject.entries()].filter(([, d]) => d >= weekAgo && d <= today).map(([k, d]) => { const [pid, prid] = k.split('|'); return { person: pById[pid], project: prById[prid], date: d } }).filter((m) => m.person && m.project)
    return { list, progressUpdates, moves, mobilised }
  }, [events, weekAgo, today, allocations, pById, prById])

  const now = useMemo(() => projects.filter((p) => p.status === 'active' || p.status === 'on_hold').map((project) => {
    const list = tasks.filter((t) => t.projectId === project.id && (t.status === 'in_progress' || t.status === 'on_hold')).map((t) => ({ task: t, view: views[t.id], people: active.filter((p) => allocToday[p.id]?.taskId === t.id) }))
    const headcount = active.filter((p) => allocToday[p.id]?.projectId === project.id).length
    const open = tasks.filter((t) => t.projectId === project.id && t.status !== 'done')
    const counts = (Object.keys(HEALTH) as Health[]).map((h) => ({ h, n: open.filter((t) => views[t.id].health === h).length })).filter((x) => x.n)
    const weighted = open.reduce((acc, t) => { const w = t.plannedDays ?? 10; return { s: acc.s + t.progress * w, w: acc.w + w } }, { s: 0, w: 0 })
    return { project, list, headcount, counts, avg: weighted.w ? Math.round(weighted.s / weighted.w) : 0, done: tasks.filter((t) => t.projectId === project.id && t.status === 'done').length, openCount: open.length }
  }), [projects, tasks, views, active, allocToday])

  const next = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'done')
    const due = open.filter((t) => t.endDate && t.endDate >= today && t.endDate <= horizon).sort((a, b) => a.endDate!.localeCompare(b.endDate!))
    const starting = open.filter((t) => t.status === 'open' && t.startDate && t.startDate >= today && t.startDate <= horizon).sort((a, b) => a.startDate!.localeCompare(b.startDate!))
    const returns = loans.filter((l) => l.status === 'active' && l.plannedReturn >= today && l.plannedReturn <= horizon).sort((a, b) => a.plannedReturn.localeCompare(b.plannedReturn))
    const freeing: { person: Person; from: string }[] = []
    const windowDays = rangeKeys(today, shiftKey(horizon, 14)).filter((d) => isWorkingDay(d, settings))
    for (const p of active) {
      const mine = windowDays.filter((d) => allocations[allocationId(p.id, d)])
      if (!mine.length) continue
      const last = mine[mine.length - 1]
      if (last <= horizon && !windowDays.some((d) => d > last && allocations[allocationId(p.id, d)])) freeing.push({ person: p, from: shiftKey(last, 1) })
    }
    freeing.sort((a, b) => a.from.localeCompare(b.from))
    const backlog = open.filter((t) => t.status === 'open' && !views[t.id].effortTotal && !(t.startDate && t.startDate <= horizon && t.startDate >= today))
    const upcomingProjects = projects.filter((p) => p.status === 'upcoming')
    return { due, starting, returns, freeing, backlog, upcomingProjects }
  }, [tasks, loans, active, allocations, settings, today, horizon, views, projects])

  if (!loaded.people || !loaded.projects || !loaded.tasks || !loaded.settings || !loaded.allocations) return <Spinner label="Loading the overview" />
  if (!projects.length) return <Empty title="Nothing to show yet" text="Add projects, people and tasks, or load the sample data from Settings." action={<Link to="/settings"><Button variant="primary">Open settings</Button></Link>} />

  const taskLabel = (t: Task | undefined) => (t ? `${prById[t.projectId]?.code ?? ''} · ${t.name}` : '')
  const eventText = (e: PlanEvent) => {
    const t = e.taskId ? tById[e.taskId] : undefined
    const who = e.personId ? pById[e.personId]?.name : ''
    const bits: string[] = []
    if (who) bits.push(who)
    if (e.kind === 'task_replanned') bits.push(`${e.from ? fmtShort(e.from) : '?'} to ${e.to ? fmtShort(e.to) : '?'}`)
    if (e.kind === 'loan_started' && e.to) bits.push(`until ${fmtShort(e.to)}`)
    if (e.reason) bits.push(REASONS[e.reason] ?? e.reason)
    return { title: EVENT_LABEL[e.kind], task: taskLabel(t), detail: bits.join(' · '), color: t ? prById[t.projectId]?.color : undefined }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-bold text-slate-900">{settings.orgName} at a glance</h1><p className="text-sm text-slate-500">What happened in the last 7 days, what is happening on {fmtShort(day)}, and what comes in the next 14 days.</p></div>
        <Link to="/board"><Button variant="primary">Open sand table</Button></Link>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        <Kpi label="On tasks today" value={`${kpis.onTask}/${active.length}`} color="#0f4c81" />
        <Kpi label="Available" value={kpis.free} color={kpis.free ? '#16a34a' : '#64748b'} />
        <Kpi label="On loan" value={kpis.onLoan} color="#f59e0b" />
        <Kpi label="In progress" value={kpis.inProgress} color="#0f4c81" />
        <Kpi label="At risk" value={kpis.atRisk} color="#f59e0b" />
        <Kpi label="Delayed" value={kpis.delayed} color="#dc2626" />
        <Kpi label="Interrupted" value={kpis.onHold} color="#7c3aed" />
        <Kpi label="Due in 14 days" value={kpis.due} color="#0f4c81" />
        <Kpi label="Backlog" value={kpis.backlog} color="#64748b" />
      </div>

      {/* project health strip */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {now.map(({ project, headcount, counts, avg, done, openCount }) => (
          <Link to="/board" key={project.id} className="rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-300" style={{ borderTopWidth: 4, borderTopColor: project.color }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="text-base font-bold" style={{ color: project.color }}>{project.code}</div><div className="truncate text-xs text-slate-600">{project.name}</div></div>
              <div className="text-right"><div className="text-lg font-bold text-slate-900">{headcount}</div><div className="text-[10px] uppercase text-slate-400">people today</div></div>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">{counts.map((c) => <div key={c.h} style={{ width: `${(c.n / Math.max(1, openCount)) * 100}%`, background: HEALTH[c.h].color }} title={`${c.n} ${HEALTH[c.h].label}`} />)}</div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-500">{counts.map((c) => <span key={c.h} style={{ color: HEALTH[c.h].text }}>{c.n} {HEALTH[c.h].label.toLowerCase()}</span>)}{done > 0 && <span>{done} done</span>}</div>
            <div className="mt-1 text-xs text-slate-600">Open work <b>{avg}%</b> complete (weighted by effort)</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* happened */}
        <Section title="What happened" subtitle="last 7 days" accent="#64748b">
          {happened.mobilised.length > 0 && <Row color="#16a34a" title={`${happened.mobilised.length} mobilised`} detail={happened.mobilised.slice(0, 6).map((m) => `${m.person.name} to ${m.project.code}`).join(', ')} />}
          {(happened.progressUpdates > 0 || happened.moves > 0) && <Row color="#0f4c81" title="Routine" detail={`${happened.progressUpdates} progress updates · ${happened.moves} allocation changes`} />}
          {happened.list.map((e) => { const x = eventText(e); return <Row key={e.id} color={KIND_COLOR[e.kind]} title={x.title} task={x.task} taskColor={x.color} detail={`${x.detail ? x.detail + ' · ' : ''}${fmtShort(e.date)} · ${e.byName}`} /> })}
          {!happened.list.length && !happened.mobilised.length && <div className="text-sm text-slate-400">Quiet week. Nothing notable recorded.</div>}
        </Section>

        {/* now */}
        <Section title="Happening now" subtitle={fmtShort(day)} accent="#16a34a">
          {now.map(({ project, list }) => list.length ? (
            <div key={project.id} className="mb-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: project.color }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: project.color }} />{project.code}</div>
              {list.map(({ task, view, people: ps }) => (
                <div key={task.id} className="mb-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                  <div className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium text-slate-800">{task.name}</span><span className="shrink-0 rounded px-1 text-[10px] font-semibold" style={{ background: HEALTH[view.health].bg, color: HEALTH[view.health].text }}>{HEALTH[view.health].label}</span></div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1"><ProgressBar actual={view.actualPct} planned={view.plannedPct} color={HEALTH[view.health].color} height={6} /></div>
                    <span className="w-24 shrink-0 text-right text-[10px] text-slate-500">{view.actualPct}%{view.plannedPct !== null ? ` / plan ${view.plannedPct}%` : ''}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    {ps.map((p) => <Avatar key={p.id} person={p} size={24} ring={disciplineColor(p.discipline, settings)} loan={!!allocToday[p.id]?.loanId} />)}
                    {!ps.length && <span className="text-[10px] text-amber-700">nobody on it today</span>}
                    {task.endDate && <span className="ml-auto text-[10px] text-slate-500">due {fmtShort(task.endDate)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : null)}
          {kpis.free > 0 && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
              <div className="text-xs font-semibold text-emerald-800">Available today ({kpis.free})</div>
              <div className="mt-1 flex flex-wrap gap-1">{active.filter((p) => !allocToday[p.id]).map((p) => <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[11px]"><Avatar person={p} size={18} ring={disciplineColor(p.discipline, settings)} />{p.name}</span>)}</div>
            </div>
          )}
        </Section>

        {/* next */}
        <Section title="Coming up" subtitle="next 14 days and pipeline" accent="#0f4c81">
          {next.due.map((t) => <Row key={'due' + t.id} color={HEALTH[views[t.id].health].color} title={`Due ${fmtShort(t.endDate!)}`} task={taskLabel(t)} taskColor={prById[t.projectId]?.color} detail={`${views[t.id].actualPct}% done · ${HEALTH[views[t.id].health].label}`} />)}
          {next.starting.map((t) => <Row key={'start' + t.id} color="#16a34a" title={`Starts ${fmtShort(t.startDate!)}`} task={taskLabel(t)} taskColor={prById[t.projectId]?.color} detail={views[t.id].effortTotal ? `${views[t.id].effortTotal} person-days scheduled` : 'nobody scheduled yet'} />)}
          {next.returns.map((l) => <Row key={l.id} color="#f59e0b" title={`${pById[l.personId]?.name ?? ''} returns ${fmtShort(l.plannedReturn)}`} task={taskLabel(tById[l.fromTaskId])} taskColor={prById[l.fromProjectId]?.color} detail={`from ${taskLabel(tById[l.toTaskId])}`} />)}
          {next.freeing.length > 0 && <Row color="#16a34a" title="Becoming available" detail={next.freeing.slice(0, 8).map((f) => `${f.person.name} from ${fmtShort(f.from)}`).join(', ')} />}
          {next.upcomingProjects.length > 0 && <Row color="#64748b" title="Pipeline projects" detail={next.upcomingProjects.map((p) => `${p.code} ${p.name}`).join(', ')} />}
          {next.backlog.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold text-slate-600">Backlog, not scheduled ({next.backlog.length})</div>
              <ul className="mt-1 space-y-0.5">{next.backlog.slice(0, 12).map((t) => <li key={t.id} className="truncate text-xs text-slate-600"><span className="font-semibold" style={{ color: prById[t.projectId]?.color }}>{prById[t.projectId]?.code}</span> {t.name}{t.endDate ? <span className="text-slate-400"> · due {fmtShort(t.endDate)}</span> : null}</li>)}</ul>
            </div>
          )}
          {!next.due.length && !next.starting.length && !next.returns.length && !next.backlog.length && <div className="text-sm text-slate-400">Nothing scheduled in the next two weeks.</div>}
        </Section>
      </div>
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: string | number; color: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div className="text-xl font-bold leading-tight" style={{ color }}>{value}</div><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div></div>
}
function Section({ title, subtitle, accent, children }: { title: string; subtitle: string; accent: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3" style={{ borderTopWidth: 4, borderTopColor: accent }}><div className="mb-2 flex items-baseline justify-between"><h2 className="font-semibold text-slate-900">{title}</h2><span className="text-xs text-slate-500">{subtitle}</span></div><div className="max-h-[60vh] overflow-y-auto pr-1">{children}</div></div>
}
function Row({ color, title, task, taskColor, detail }: { color?: string; title: string; task?: string; taskColor?: string; detail?: string }) {
  return <div className="mb-1.5 flex gap-2 text-sm"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? '#94a3b8' }} /><div className="min-w-0"><span className="font-medium text-slate-800">{title}</span>{task && <span className="text-slate-700"> · <span className="font-semibold" style={{ color: taskColor }}>{task.split(' · ')[0]}</span> {task.split(' · ').slice(1).join(' · ')}</span>}{detail && <div className="truncate text-xs text-slate-500">{detail}</div>}</div></div>
}
