import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { extendLoan, returnLoan, setPersonPhoto } from '../../lib/repo'
import { Button, Dialog, Field, Input } from '../ui'
import { allocationId, PERSON_TYPE_LABEL, REASONS } from '../../lib/types'
import { consecutiveRuns, fmtShort, isWorkingDay, rangeKeys, shiftKey } from '../../lib/dates'
import { disciplineColor } from '../../lib/progress'
import { fileToAvatarDataUrl } from '../../lib/photo'
import { Avatar } from '../Avatar'
import type { MoveRequest } from './MoveSheet'

export function PersonPopover({ personId, date, onClose, onMove, onOpenTask }: { personId: string | null; date: string; onClose: () => void; onMove: (r: MoveRequest) => void; onOpenTask: (taskId: string) => void }) {
  const { people, tasks, projects, allocations, loans, settings, toast } = useStore()
  const canEdit = useStore((s) => s.canEdit)()
  const person = people.find((p) => p.id === personId)
  const [extendTo, setExtendTo] = useState('')
  const [busy, setBusy] = useState(false)

  const today = allocations[allocationId(personId ?? '', date)]
  const task = tasks.find((t) => t.id === today?.taskId)
  const project = projects.find((p) => p.id === today?.projectId)
  const loan = useMemo(() => (today?.loanId ? loans.find((l) => l.id === today.loanId) : loans.find((l) => l.personId === personId && l.status === 'active' && l.startDate <= date && l.plannedReturn >= date)), [today, loans, personId, date])
  const homeTask = tasks.find((t) => t.id === loan?.fromTaskId)
  const block = useMemo(() => {
    if (!today) return null
    const mine = Object.values(allocations).filter((a) => a.personId === personId && a.taskId === today.taskId).map((a) => a.date)
    return consecutiveRuns(mine).find((r) => r.includes(date)) ?? [date]
  }, [today, allocations, personId, date])
  const strip = useMemo(() => {
    if (!personId) return []
    return rangeKeys(date, shiftKey(date, 20)).filter((d) => isWorkingDay(d, settings)).slice(0, 10).map((d) => {
      const a = allocations[allocationId(personId, d)]
      return { d, color: a ? projects.find((p) => p.id === a.projectId)?.color ?? '#94a3b8' : null, code: a ? projects.find((p) => p.id === a.projectId)?.code ?? '' : '', loan: !!a?.loanId }
    })
  }, [personId, date, allocations, projects, settings])
  const lead = people.find((p) => p.id === person?.leadId)

  if (!person) return null
  const ring = disciplineColor(person.discipline, settings)
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); onClose() } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) } }

  return (
    <Dialog open onClose={onClose} title={person.name} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex items-center gap-4">
        <Avatar person={person} size={72} ring={ring} loan={!!loan} />
        <div className="text-sm">
          <div className="font-semibold">{person.title}</div>
          <div className="flex items-center gap-1.5 text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: ring }} />{person.discipline || 'No discipline'} · {PERSON_TYPE_LABEL[person.type]}</div>
          {lead && <div className="text-xs text-slate-500">Team lead: {lead.name}</div>}
          {canEdit && (
            <label className="mt-1 inline-block cursor-pointer text-xs text-brand underline">{person.photo ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await setPersonPhoto(person.id, await fileToAvatarDataUrl(f)) } catch { toast('Could not read that image', 'error') } }} />
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">On {fmtShort(date)}</div>
        {task && project ? (
          <button className="mt-1 text-left" onClick={() => onOpenTask(task.id)}>
            <div className="flex items-center gap-2 font-medium"><span className="h-3 w-3 rounded-full" style={{ background: project.color }} />{project.code} · {task.name}</div>
            {block && <div className="text-xs text-slate-500">Block {fmtShort(block[0])} to {fmtShort(block[block.length - 1])} ({block.length} working days)</div>}
          </button>
        ) : <div className="mt-1 text-slate-500">Available (no task)</div>}
        {loan && homeTask && (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <div className="font-semibold">On loan until {fmtShort(loan.plannedReturn)}</div>
            <div>Returns to <b>{projects.find((p) => p.id === loan.fromProjectId)?.code} · {homeTask.name}</b>. {REASONS[loan.reason] ?? loan.reason}{loan.note ? ` · ${loan.note}` : ''}</div>
            {canEdit && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Button busy={busy} onClick={() => act(() => returnLoan(loan.id, date))}>Return now (from {fmtShort(date)})</Button>
                <Field label="Extend until"><div className="flex gap-1"><Input type="date" value={extendTo} min={shiftKey(loan.plannedReturn, 1)} onChange={(e) => setExtendTo(e.target.value)} compact /><Button busy={busy} disabled={!extendTo} onClick={() => act(() => extendLoan(loan.id, extendTo))}>Extend</Button></div></Field>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next 10 working days</div>
        <div className="mt-1 flex gap-1">
          {strip.map((s) => <div key={s.d} className={`flex h-9 flex-1 flex-col items-center justify-center rounded text-[9px] ${s.color ? 'text-white' : 'bg-slate-100 text-slate-400'} ${s.loan ? 'ring-2 ring-amber-400' : ''}`} style={s.color ? { background: s.color } : undefined} title={s.d}><span>{fmtShort(s.d).split(' ')[0]}</span><span className="font-semibold">{s.code || 'free'}</span></div>)}
        </div>
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          {task && <Button onClick={() => { onClose(); onMove({ personId: person.id, fromTaskId: task.id, toTaskId: null, date }) }}>Free from task</Button>}
          <Link to="/calendar"><Button variant="ghost">Open calendar</Button></Link>
        </div>
      )}
      {person.notes && <div className="mt-3 text-sm text-slate-600">{person.notes}</div>}
    </Dialog>
  )
}
