import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { movePerson, releasePerson } from '../../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui'
import { allocationId, REASONS } from '../../lib/types'
import { consecutiveRuns, fmtShort, shiftKey } from '../../lib/dates'
import { addWorkingDays, nextWorkingDay } from '../../lib/progress'

export interface MoveRequest { personId: string; fromTaskId: string | null; toTaskId: string | null; date: string }

export function MoveSheet({ req, onClose }: { req: MoveRequest | null; onClose: () => void }) {
  const { people, tasks, projects, allocations, settings, toast } = useStore()
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [mode, setMode] = useState<'move' | 'lend'>('move')
  const [reason, setReason] = useState('resource_moved')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const person = people.find((p) => p.id === req?.personId)
  const fromTask = tasks.find((t) => t.id === req?.fromTaskId)
  const toTask = tasks.find((t) => t.id === req?.toTaskId)
  const toProject = projects.find((p) => p.id === toTask?.projectId)
  const fromProject = projects.find((p) => p.id === fromTask?.projectId)

  const blockEnd = useMemo(() => {
    if (!req || !fromTask) return null
    const mine = Object.values(allocations).filter((a) => a.personId === req.personId && a.taskId === fromTask.id).map((a) => a.date)
    const run = consecutiveRuns(mine).find((r) => r.includes(req.date))
    return run ? run[run.length - 1] : req.date
  }, [req, fromTask, allocations])

  useEffect(() => {
    if (!req) return
    const f = nextWorkingDay(req.date, settings)
    setFrom(f)
    if (toTask) setUntil(toTask.endDate && toTask.endDate >= f ? toTask.endDate : addWorkingDays(f, 4, settings))
    else setUntil(blockEnd && blockEnd >= f ? blockEnd : f)
    setMode(fromTask && toTask && fromTask.projectId !== toTask.projectId ? 'lend' : 'move')
    setReason(toTask ? 'resource_moved' : 'priority_change')
    setNote('')
  }, [req, toTask, fromTask, blockEnd, settings])

  if (!req || !person) return null
  const isRelease = !toTask
  const conflicts = (() => {
    if (!toTask) return 0
    let n = 0
    let d = from
    while (d && until && d <= until) { const a = allocations[allocationId(person.id, d)]; if (a && a.taskId !== fromTask?.id && a.taskId !== toTask.id) n++; d = shiftKey(d, 1) }
    return n
  })()

  const save = async () => {
    if (!from || !until || until < from) { toast('Check the dates', 'error'); return }
    setBusy(true)
    try {
      if (isRelease && fromTask) await releasePerson({ personId: person.id, taskId: fromTask.id, from, until, reason, note })
      else if (toTask) await movePerson({ personId: person.id, toTaskId: toTask.id, from, until, mode: fromTask ? mode : 'move', fromTaskId: fromTask?.id ?? null, reason: mode === 'lend' || isRelease ? reason : note ? reason : undefined, note })
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const title = isRelease ? `Free ${person.name}` : fromTask ? `Move ${person.name}` : `Put ${person.name} on a task`
  const quick = (k: 'day' | 'week' | 'task' | 'block') => {
    if (k === 'day') setUntil(from)
    if (k === 'week') setUntil(addWorkingDays(from, Math.max(0, settings.workingDays.length - 1), settings))
    if (k === 'task' && toTask?.endDate) setUntil(toTask.endDate)
    if (k === 'block' && blockEnd) setUntil(blockEnd)
  }

  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{isRelease ? 'Free from task' : mode === 'lend' ? 'Lend' : fromTask ? 'Move' : 'Assign'}</Button></>}>
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        {fromTask && <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: fromProject?.color }} /><span className="text-slate-500">From</span><b>{fromProject?.code}</b> {fromTask.name}{blockEnd && <span className="text-xs text-slate-500">(planned until {fmtShort(blockEnd)})</span>}</div>}
        {toTask ? <div className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: toProject?.color }} /><span className="text-slate-500">To</span><b>{toProject?.code}</b> {toTask.name}{toTask.endDate && <span className="text-xs text-slate-500">(due {fmtShort(toTask.endDate)})</span>}</div>
          : <div className="mt-1 text-slate-700">Remove from the task for the chosen days. They appear under Available.</div>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Until (inclusive)"><Input type="date" value={until} min={from} onChange={(e) => setUntil(e.target.value)} /></Field>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        <button className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-50" onClick={() => quick('day')}>One day</button>
        <button className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-50" onClick={() => quick('week')}>One week</button>
        {toTask?.endDate && <button className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-50" onClick={() => quick('task')}>Until task due date</button>}
        {blockEnd && <button className="rounded-full border border-slate-300 px-2 py-0.5 hover:bg-slate-50" onClick={() => quick('block')}>Rest of current block</button>}
      </div>

      {fromTask && toTask && (
        <Field label="How" className="mt-3" group>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-lg border p-2.5 text-sm ${mode === 'move' ? 'border-brand bg-brand/10' : 'border-slate-300'}`}>
              <input type="radio" className="sr-only" checked={mode === 'move'} onChange={() => setMode('move')} />
              <div className="font-semibold">Move</div>
              <div className="text-xs text-slate-600">Reassign for these days. Nothing is restored afterwards.</div>
            </label>
            <label className={`cursor-pointer rounded-lg border p-2.5 text-sm ${mode === 'lend' ? 'border-amber-500 bg-amber-50' : 'border-slate-300'}`}>
              <input type="radio" className="sr-only" checked={mode === 'lend'} onChange={() => setMode('lend')} />
              <div className="font-semibold">Lend and return</div>
              <div className="text-xs text-slate-600">Tentative. Returns to <b>{fromTask.name}</b> after {until ? fmtShort(until) : 'the end date'}, or earlier with one tap.</div>
            </label>
          </div>
        </Field>
      )}

      {(mode === 'lend' || isRelease || !fromTask) && (
        <Field label="Reason" className="mt-3">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
      )}
      <Field label="Note (optional)" className="mt-3"><Textarea className="min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. client requested urgent coordination model" /></Field>
      {conflicts > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{conflicts} day{conflicts > 1 ? 's' : ''} in this range currently belong to another task and will be replaced.</div>}
    </Dialog>
  )
}
