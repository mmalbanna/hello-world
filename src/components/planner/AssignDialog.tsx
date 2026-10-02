import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { assign } from '../../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui'
import { fmtLong, rangeKeys, isWorkingDay } from '../../lib/dates'
import { TASK_STATUS_LABEL } from '../../lib/types'

export interface AssignTarget { personId: string; date: string; taskId?: string }

export function AssignDialog({ target, onClose }: { target: AssignTarget | null; onClose: () => void }) {
  const { people, projects, tasks, settings, toast } = useStore()
  const [projectId, setProjectId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [until, setUntil] = useState('')
  const [skip, setSkip] = useState(true)
  const [note, setNote] = useState('')
  const [extra, setExtra] = useState<Set<string>>(new Set())
  const [showExtra, setShowExtra] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    const t = target.taskId ? tasks.find((x) => x.id === target.taskId) : undefined
    setProjectId(t?.projectId ?? projects.find((p) => p.status === 'active')?.id ?? projects[0]?.id ?? '')
    setTaskId(t?.id ?? '')
    setUntil(target.date)
    setSkip(true)
    setNote('')
    setExtra(new Set())
    setShowExtra(false)
  }, [target, tasks, projects])

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId && t.status !== 'done'), [tasks, projectId])
  useEffect(() => {
    if (taskId && !projectTasks.some((t) => t.id === taskId)) setTaskId(projectTasks[0]?.id ?? '')
    if (!taskId && projectTasks[0]) setTaskId(projectTasks[0].id)
  }, [projectTasks, taskId])

  if (!target) return null
  const person = people.find((p) => p.id === target.personId)
  const dates = rangeKeys(target.date, until < target.date ? target.date : until)
  const effective = skip ? dates.filter((d) => isWorkingDay(d, settings)) : dates

  const save = async () => {
    if (!taskId) { toast('Choose a task', 'error'); return }
    setBusy(true)
    try {
      const ids = [target.personId, ...extra]
      for (const pid of ids) await assign(pid, taskId, dates, note, skip)
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={`Assign ${person?.name ?? ''}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Assign {effective.length > 1 ? `${effective.length} days` : ''}</Button></>}>
      <div className="mb-3 text-sm text-slate-600">From <b>{fmtLong(target.date)}</b></div>
      <div className="space-y-3">
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.filter((p) => p.status !== 'closed').map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Task">
          <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {!projectTasks.length && <option value="">No open tasks in this project</option>}
            {projectTasks.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status !== 'open' ? ` (${TASK_STATUS_LABEL[t.status]})` : ''}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Until (inclusive)"><Input type="date" value={until} min={target.date} onChange={(e) => setUntil(e.target.value || target.date)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} className="h-4 w-4" /> Skip non-working days</label>
        </div>
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[56px]" placeholder="e.g. coordinate with Suresh for steel" /></Field>
        <div>
          <button type="button" className="text-sm text-brand underline" onClick={() => setShowExtra((v) => !v)}>{showExtra ? 'Hide' : 'Also assign other people to the same task and dates'}</button>
          {showExtra && (
            <div className="mt-2 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
              {people.filter((p) => p.active && p.id !== target.personId).map((p) => (
                <label key={p.id} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={extra.has(p.id)} onChange={(e) => setExtra((s) => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n })} /> {p.name}</label>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500">Existing allocations on these days will be replaced.</p>
      </div>
    </Dialog>
  )
}
