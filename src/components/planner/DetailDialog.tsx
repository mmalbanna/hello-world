import { useEffect, useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { assign, changeTask, reassignRun, setAllocationNote, unassign, unassignRun } from '../../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui'
import { fmtLong, fmtShort, isWorkingDay, rangeKeys, shiftKey, consecutiveRuns } from '../../lib/dates'
import type { Allocation } from '../../lib/types'

type Mode = 'view' | 'task' | 'person' | 'extend' | 'remove'

export function DetailDialog({ alloc, onClose }: { alloc: Allocation | null; onClose: () => void }) {
  const { people, projects, tasks, allocations, settings, toast } = useStore()
  const canEdit = useStore((s) => s.canEdit)()
  const [mode, setMode] = useState<Mode>('view')
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [personId, setPersonId] = useState('')
  const [until, setUntil] = useState('')
  const [note, setNote] = useState('')
  const [scope, setScope] = useState<'day' | 'forward' | 'run'>('forward')

  useEffect(() => {
    if (!alloc) return
    setMode('view'); setNote(alloc.note ?? ''); setScope('forward')
    setProjectId(alloc.projectId); setTaskId(alloc.taskId); setPersonId(''); setUntil(shiftKey(alloc.date, 1))
  }, [alloc])

  const run = useMemo(() => {
    if (!alloc) return [] as string[]
    const mine = Object.values(allocations).filter((x) => x.personId === alloc.personId && x.taskId === alloc.taskId).map((x) => x.date)
    return consecutiveRuns(mine).find((r) => r.includes(alloc.date)) ?? [alloc.date]
  }, [alloc, allocations])

  if (!alloc) return null
  const person = people.find((p) => p.id === alloc.personId)
  const task = tasks.find((t) => t.id === alloc.taskId)
  const project = projects.find((p) => p.id === alloc.projectId)
  const forward = run.filter((d) => d >= alloc.date)
  const projectTasks = tasks.filter((t) => t.projectId === projectId && t.status !== 'done')
  const updated = alloc.updatedAt instanceof Timestamp ? format(alloc.updatedAt.toDate(), 'd MMM HH:mm') : ''

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn(); onClose() } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const footer = (() => {
    if (!canEdit) return <Button onClick={onClose}>Close</Button>
    if (mode === 'view') return <Button onClick={onClose}>Close</Button>
    const back = <Button onClick={() => setMode('view')}>Back</Button>
    if (mode === 'task') return <>{back}<Button variant="primary" busy={busy} disabled={!taskId || taskId === alloc.taskId} onClick={() => wrap(() => changeTask(alloc, taskId, scope === 'day' ? 'day' : 'forward'))}>Change task</Button></>
    if (mode === 'person') return <>{back}<Button variant="primary" busy={busy} disabled={!personId} onClick={() => wrap(() => reassignRun(alloc, personId, scope))}>Reassign</Button></>
    if (mode === 'extend') {
      const dates = rangeKeys(shiftKey(alloc.date, 1), until).filter((d) => isWorkingDay(d, settings))
      return <>{back}<Button variant="primary" busy={busy} disabled={!dates.length} onClick={() => wrap(() => assign(alloc.personId, alloc.taskId, dates, alloc.note, true))}>Extend {dates.length ? `(${dates.length} days)` : ''}</Button></>
    }
    return <>{back}<Button variant="danger" busy={busy} onClick={() => wrap(() => (scope === 'day' ? unassign([alloc.id]) : scope === 'forward' ? unassignRun(alloc, 'forward') : unassignRun(alloc, 'both')))}>Remove</Button></>
  })()

  const ScopePicker = ({ allowRun }: { allowRun?: boolean }) => (
    <Field label="Apply to">
      <div className="flex flex-wrap gap-2 text-sm">
        {[
          ['day', `This day only (${fmtShort(alloc.date)})`],
          ['forward', `This and following days (${forward.length})`],
          ...(allowRun ? [['run', `Whole block (${run.length} days from ${fmtShort(run[0])})`]] : []),
        ].map(([v, l]) => (
          <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 ${scope === v ? 'border-brand bg-brand/10 text-brand' : 'border-slate-300'}`}>
            <input type="radio" className="sr-only" checked={scope === v} onChange={() => setScope(v as typeof scope)} />{l}
          </label>
        ))}
      </div>
    </Field>
  )

  return (
    <Dialog open onClose={onClose} title={person?.name ?? 'Allocation'} footer={footer}>
      <div className="flex items-start gap-3">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: project?.color }} />
        <div>
          <div className="font-semibold text-slate-900">{project?.code} · {project?.name}</div>
          <div className="text-sm text-slate-800">{task?.name ?? 'Unknown task'}</div>
          <div className="mt-1 text-xs text-slate-500">{fmtLong(alloc.date)}{run.length > 1 ? ` · part of a ${run.length}-day block (${fmtShort(run[0])} to ${fmtShort(run[run.length - 1])})` : ''}</div>
          {updated && <div className="text-xs text-slate-400">Last changed by {alloc.updatedByName} on {updated}</div>}
        </div>
      </div>

      {mode === 'view' && (
        <div className="mt-4 space-y-3">
          <Field label="Note">
            {canEdit ? (
              <div className="flex gap-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[56px]" />
                <Button disabled={note === (alloc.note ?? '')} onClick={() => wrap(() => setAllocationNote(alloc.id, note))}>Save</Button>
              </div>
            ) : <div className="text-sm text-slate-700">{alloc.note || '—'}</div>}
          </Field>
          {canEdit && (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setMode('task')}>Change task</Button>
              <Button onClick={() => setMode('person')}>Move to another person</Button>
              <Button onClick={() => setMode('extend')}>Extend to a later date</Button>
              <Button variant="danger" onClick={() => setMode('remove')}>Remove</Button>
            </div>
          )}
        </div>
      )}

      {mode === 'task' && (
        <div className="mt-4 space-y-3">
          <Field label="Project"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId('') }}>{projects.filter((p) => p.status !== 'closed').map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select></Field>
          <Field label="Task"><Select value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">Choose a task</option>{projectTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <ScopePicker />
        </div>
      )}
      {mode === 'person' && (
        <div className="mt-4 space-y-3">
          <Field label="Move to"><Select value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">Choose a person</option>{people.filter((p) => p.active && p.id !== alloc.personId).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.discipline}</option>)}</Select></Field>
          <ScopePicker allowRun />
          <p className="text-xs text-slate-500">If the other person already has something on those days it will be replaced.</p>
        </div>
      )}
      {mode === 'extend' && (
        <div className="mt-4 space-y-3">
          <Field label="Until (inclusive)"><Input type="date" value={until} min={shiftKey(alloc.date, 1)} onChange={(e) => setUntil(e.target.value)} /></Field>
          <p className="text-xs text-slate-500">Non-working days are skipped. Existing allocations on those days are replaced.</p>
        </div>
      )}
      {mode === 'remove' && <div className="mt-4"><ScopePicker allowRun /></div>}
    </Dialog>
  )
}
