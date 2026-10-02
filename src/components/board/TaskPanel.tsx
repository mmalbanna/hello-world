import { useEffect, useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { fetchTaskAllocations, fetchTaskEvents, interruptTask, reopenTask, replanTask, resumeTask, updateProgress, upsertTask } from '../../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui'
import { EVENT_LABEL, PRIORITY_LABEL, REASONS, TASK_STATUS_LABEL, type Allocation, type Person, type PlanEvent, type Priority, type Task } from '../../lib/types'
import { consecutiveRuns, fmtLong, fmtShort } from '../../lib/dates'
import { HEALTH, disciplineColor, plannedPercent, taskHealth } from '../../lib/progress'
import { Avatar } from '../Avatar'
import { ProgressBar } from './TaskCard'

type Mode = 'view' | 'progress' | 'interrupt' | 'replan' | 'edit' | 'complete'

const KIND_COLOR: Record<string, string> = {
  task_completed: '#2563eb', task_started: '#16a34a', progress: '#16a34a', task_interrupted: '#7c3aed', task_resumed: '#0891b2', task_replanned: '#dc2626',
  loan_started: '#f59e0b', loan_returned: '#f59e0b', loan_extended: '#f59e0b', assigned: '#0f4c81', moved: '#0f4c81', released: '#64748b', task_created: '#64748b', task_reopened: '#0891b2',
}

export function TaskPanel({ taskId, date, onClose, onOpenPerson }: { taskId: string | null; date: string; onClose: () => void; onOpenPerson: (p: Person) => void }) {
  const { tasks, projects, people, allocations, settings, toast } = useStore()
  const canEdit = useStore((s) => s.canEdit)()
  const task = tasks.find((t) => t.id === taskId)
  const project = projects.find((p) => p.id === task?.projectId)
  const [mode, setMode] = useState<Mode>('view')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('missing_input')
  const [newEnd, setNewEnd] = useState('')
  const [events, setEvents] = useState<PlanEvent[] | null>(null)
  const [allocs, setAllocs] = useState<Allocation[] | null>(null)
  const [form, setForm] = useState<Partial<Task>>({})

  useEffect(() => {
    if (!taskId) return
    setMode('view'); setNote(''); setEvents(null); setAllocs(null)
    const t = tasks.find((x) => x.id === taskId)
    setProgress(t?.progress ?? 0); setNewEnd(t?.endDate ?? '')
    fetchTaskEvents(taskId).then(setEvents).catch(() => setEvents([]))
    fetchTaskAllocations(taskId).then(setAllocs).catch(() => setAllocs([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const effortList = allocs ?? Object.values(allocations).filter((a) => a.taskId === taskId)
  const view = useMemo(() => {
    if (!task) return null
    const eff = effortList.filter((a) => a.date <= date).length
    const planned = plannedPercent(task, date, settings, eff)
    return { eff, planned, total: effortList.length, health: taskHealth(task, date, planned, eff) }
  }, [task, effortList, date, settings])

  const perPerson = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const a of effortList) (m.get(a.personId) ?? m.set(a.personId, []).get(a.personId)!).push(a.date)
    return [...m.entries()].map(([pid, ds]) => ({ person: people.find((p) => p.id === pid), days: ds.length, runs: consecutiveRuns(ds), today: ds.includes(date) })).filter((x) => x.person).sort((a, b) => Number(b.today) - Number(a.today) || b.days - a.days)
  }, [effortList, people, date])

  if (!task || !project || !view) return null
  const h = HEALTH[view.health]
  const wrap = async (fn: () => Promise<void>, close = false) => {
    setBusy(true)
    try { await fn(); if (close) onClose(); else { setMode('view'); fetchTaskEvents(task.id).then(setEvents).catch(() => {}) } } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const reload = () => { fetchTaskEvents(task.id).then(setEvents).catch(() => {}) }

  const footer = (() => {
    if (!canEdit || mode === 'view') return <Button onClick={onClose}>Close</Button>
    const back = <Button onClick={() => setMode('view')}>Back</Button>
    if (mode === 'progress') return <>{back}<Button variant="primary" busy={busy} onClick={() => wrap(() => updateProgress(task.id, progress, note, date))}>Save progress</Button></>
    if (mode === 'complete') return <>{back}<Button variant="primary" busy={busy} onClick={() => wrap(() => updateProgress(task.id, 100, note, date))}>Mark done</Button></>
    if (mode === 'interrupt') return <>{back}<Button variant="danger" busy={busy} onClick={() => wrap(() => interruptTask(task.id, reason, note, date))}>Interrupt</Button></>
    if (mode === 'replan') return <>{back}<Button variant="primary" busy={busy} disabled={!newEnd || newEnd === task.endDate} onClick={() => wrap(() => replanTask(task.id, newEnd, reason, note, date))}>Replan</Button></>
    if (mode === 'edit') return <>{back}<Button variant="primary" busy={busy} onClick={() => wrap(async () => { await upsertTask({ ...task, ...form, projectId: task.projectId, name: (form.name ?? task.name) }, task.id) })}>Save</Button></>
    return null
  })()

  return (
    <Dialog open onClose={onClose} title={task.name} wide footer={footer}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: project.color }}><span className="h-3 w-3 rounded-full" style={{ background: project.color }} />{project.code} · {project.name}</span>
        <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: h.bg, color: h.text }}>{h.label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{TASK_STATUS_LABEL[task.status]}</span>
        {task.priority !== 'normal' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{PRIORITY_LABEL[task.priority]}</span>}
        {task.discipline && <span className="text-xs text-slate-500">{task.discipline}</span>}
      </div>
      {task.deliverable && <div className="mt-1 text-sm text-slate-600"><span className="text-slate-400">Deliverable:</span> {task.deliverable}</div>}

      {mode === 'view' && (
        <>
          <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <div className="flex items-end justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Planned vs actual at {fmtShort(date)}</div>
              <div className="text-sm"><b className="text-lg" style={{ color: h.color }}>{task.status === 'done' ? 100 : task.progress}%</b>{view.planned !== null && <span className="text-slate-500"> actual vs {view.planned}% planned</span>}</div>
            </div>
            <div className="mt-2"><ProgressBar actual={task.status === 'done' ? 100 : task.progress} planned={view.planned} color={h.color} height={12} /></div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Stat label="Planned start" value={task.startDate ? fmtShort(task.startDate) : 'not set'} />
              <Stat label="Planned finish" value={task.endDate ? fmtShort(task.endDate) : 'not set'} warn={!!task.endDate && task.endDate < date && task.status !== 'done'} />
              <Stat label="Actual start" value={task.actualStart ? fmtShort(task.actualStart) : 'not started'} />
              <Stat label="Actual finish" value={task.actualEnd ? fmtShort(task.actualEnd) : task.status === 'done' ? 'done' : 'open'} />
              <Stat label="Planned effort" value={task.plannedDays ? `${task.plannedDays} person-days` : 'not set'} />
              <Stat label="Effort to date" value={`${view.eff} person-days`} warn={!!task.plannedDays && view.eff > task.plannedDays} />
              <Stat label="Effort scheduled" value={`${view.total} person-days`} />
              <Stat label="Last update" value={task.progressUpdatedAt instanceof Timestamp ? `${format(task.progressUpdatedAt.toDate(), 'd MMM')} by ${task.progressUpdatedBy ?? ''}` : 'none'} />
            </div>
          </div>

          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.status !== 'done' && <Button variant="primary" onClick={() => setMode('progress')}>Update progress</Button>}
              {task.status === 'on_hold' ? <Button onClick={() => wrap(() => resumeTask(task.id, '', date))} busy={busy}>Resume</Button> : task.status !== 'done' && <Button onClick={() => { setReason('missing_input'); setMode('interrupt') }}>Interrupt</Button>}
              {task.status !== 'done' && <Button onClick={() => { setReason('scope_change'); setMode('replan') }}>Replan finish</Button>}
              {task.status !== 'done' ? <Button onClick={() => setMode('complete')}>Mark done</Button> : <Button onClick={() => wrap(() => reopenTask(task.id, '', date))} busy={busy}>Reopen</Button>}
              <Button variant="ghost" onClick={() => { setForm({ name: task.name, startDate: task.startDate, endDate: task.endDate, plannedDays: task.plannedDays, headcount: task.headcount, priority: task.priority, discipline: task.discipline, deliverable: task.deliverable, notes: task.notes }); setMode('edit') }}>Edit details</Button>
            </div>
          )}

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">People</div>
            {!perPerson.length ? <div className="mt-1 text-sm text-slate-400">Nobody has been allocated yet.</div> : (
              <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {perPerson.map(({ person, days, runs, today }) => (
                  <li key={person!.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <button onClick={() => onOpenPerson(person!)}><Avatar person={person!} size={32} ring={disciplineColor(person!.discipline, settings)} /></button>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{person!.name} <span className="text-xs text-slate-500">{person!.discipline}</span>{today && <span className="ml-2 rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800">today</span>}</div>
                      <div className="truncate text-xs text-slate-500">{runs.map((r) => (r.length === 1 ? fmtShort(r[0]) : `${fmtShort(r[0])} to ${fmtShort(r[r.length - 1])}`)).join(', ')}</div>
                    </div>
                    <div className="text-xs text-slate-600">{days} pd</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">History</div><button className="text-xs text-slate-500 underline" onClick={reload}>Refresh</button></div>
            {events === null ? <div className="mt-1 text-sm text-slate-400">Loading…</div> : !events.length ? <div className="mt-1 text-sm text-slate-400">No events recorded yet.</div> : (
              <ol className="mt-1 space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] ?? '#64748b' }} />
                    <div>
                      <span className="font-medium">{EVENT_LABEL[e.kind]}</span>
                      {e.progress !== null && e.kind === 'progress' && <span> to {e.progress}%</span>}
                      {e.personId && <span> · {people.find((p) => p.id === e.personId)?.name ?? ''}</span>}
                      {e.kind === 'task_replanned' && <span> · {e.from ? fmtShort(e.from) : '?'} to {e.to ? fmtShort(e.to) : '?'}</span>}
                      {e.kind !== 'task_replanned' && e.from && e.to && <span> · {e.from === e.to ? fmtShort(e.from) : `${fmtShort(e.from)} to ${fmtShort(e.to)}`}</span>}
                      {e.fromTaskId && e.toTaskId && e.fromTaskId !== e.toTaskId && <span> · {e.fromTaskId === task.id ? `to ${tasks.find((t) => t.id === e.toTaskId)?.name ?? ''}` : `from ${tasks.find((t) => t.id === e.fromTaskId)?.name ?? ''}`}</span>}
                      {e.reason && <span className="text-slate-700"> · {REASONS[e.reason] ?? e.reason}</span>}
                      {e.note && <span className="text-slate-600"> · {e.note}</span>}
                      <div className="text-xs text-slate-400">{fmtLong(e.date)} · {e.byName}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {task.notes && <div className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{task.notes}</div>}
        </>
      )}

      {mode === 'progress' && (
        <div className="mt-4 space-y-3">
          <Field label={`Actual progress: ${progress}%`} group>
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full" />
            <div className="mt-1 flex gap-1">{[0, 25, 50, 75, 100].map((v) => <button key={v} className={`rounded border px-2 py-0.5 text-xs ${progress === v ? 'border-brand bg-brand/10 text-brand' : 'border-slate-300'}`} onClick={() => setProgress(v)}>{v}%</button>)}<Input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="ml-auto max-w-[90px]" /></div>
          </Field>
          {view.planned !== null && <div className="text-xs text-slate-500">Plan expects {view.planned}% by {fmtShort(date)}.</div>}
          <Field label="Remark (optional)"><Textarea className="min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Level 12 to 15 modelled, awaiting MEP input for 16" /></Field>
        </div>
      )}
      {mode === 'complete' && (
        <div className="mt-4 space-y-3">
          <div className="text-sm">Mark <b>{task.name}</b> as done on {fmtLong(date)}. Progress becomes 100%.</div>
          <Field label="Remark (optional)"><Textarea className="min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}
      {mode === 'interrupt' && (
        <div className="mt-4 space-y-3">
          <div className="text-sm">The task is put on hold from {fmtLong(date)}. People stay allocated until you move them.</div>
          <Field label="Why"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Details"><Textarea className="min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is blocking, who is chasing it" /></Field>
        </div>
      )}
      {mode === 'replan' && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current planned finish"><div className="py-2 text-sm">{task.endDate ? fmtLong(task.endDate) : 'not set'}</div></Field>
            <Field label="New planned finish"><Input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></Field>
          </div>
          <Field label="Why"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Details"><Textarea className="min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}
      {mode === 'edit' && (
        <div className="mt-4 space-y-3">
          <Field label="Task name"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planned start"><Input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || null })} /></Field>
            <Field label="Planned finish"><Input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || null })} /></Field>
            <Field label="Planned effort (person-days)"><Input type="number" min={0} value={form.plannedDays ?? ''} onChange={(e) => setForm({ ...form, plannedDays: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="People needed per day"><Input type="number" min={0} value={form.headcount ?? ''} onChange={(e) => setForm({ ...form, headcount: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Priority"><Select value={form.priority ?? 'normal'} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>{(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
            <Field label="Discipline"><Select value={form.discipline ?? ''} onChange={(e) => setForm({ ...form, discipline: e.target.value })}><option value="">Any</option>{settings.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          </div>
          <Field label="Deliverable"><Input value={form.deliverable ?? ''} onChange={(e) => setForm({ ...form, deliverable: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      )}
    </Dialog>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div><div className={`text-sm ${warn ? 'font-semibold text-red-600' : 'text-slate-800'}`}>{value}</div></div>
}
