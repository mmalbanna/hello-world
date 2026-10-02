import { useDroppable } from '@dnd-kit/core'
import { AlertTriangle, PauseCircle, CheckCircle2, Flag } from 'lucide-react'
import type { Person, Project, Task } from '../../lib/types'
import { HEALTH, type TaskStatusView } from '../../lib/progress'
import { fmtShort } from '../../lib/dates'
import { PersonToken } from './PersonToken'

export interface CardPerson { person: Person; ring: string; loanReturn: string | null }

export function ProgressBar({ actual, planned, color, height = 8 }: { actual: number; planned: number | null; color: string; height?: number }) {
  return (
    <div className="relative w-full overflow-visible rounded-full bg-slate-200" style={{ height }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, actual)}%`, background: color }} />
      {planned !== null && (
        <div className="absolute -top-1 w-0.5 bg-slate-800" style={{ left: `calc(${Math.min(100, planned)}% - 1px)`, height: height + 8 }} title={`Planned ${planned}%`} />
      )}
    </div>
  )
}

export function TaskCard({ task, project, view, people, date, canEdit, onOpen, onOpenPerson, compact }: {
  task: Task; project: Project; view: TaskStatusView; people: CardPerson[]; date: string; canEdit: boolean; onOpen: () => void; onOpenPerson: (p: Person) => void; compact?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `task:${task.id}`, data: { taskId: task.id }, disabled: !canEdit || task.status === 'done' })
  const h = HEALTH[view.health]
  const slots = task.headcount ? Math.max(0, task.headcount - people.length) : 0
  const daysLeft = task.endDate ? Math.round((new Date(task.endDate).getTime() - new Date(date).getTime()) / 86400000) : null
  return (
    <div ref={setNodeRef} onClick={onOpen} className={`group relative cursor-pointer rounded-xl border bg-white p-2.5 shadow-sm transition ${isOver ? 'ring-2 ring-brand border-brand bg-brand/5' : 'border-slate-200 hover:border-slate-300'} ${task.status === 'done' ? 'opacity-60' : ''}`} style={{ borderLeftWidth: 5, borderLeftColor: project.color }}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">{task.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
            <span className="rounded px-1 font-semibold" style={{ background: h.bg, color: h.text }}>{h.label}</span>
            {task.priority === 'urgent' && <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 font-semibold text-red-700"><Flag className="h-3 w-3" />Urgent</span>}
            {task.priority === 'high' && <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 font-semibold text-amber-800"><Flag className="h-3 w-3" />High</span>}
            {task.discipline && <span>{task.discipline}</span>}
          </div>
        </div>
        {view.health === 'on_hold' && <PauseCircle className="h-4 w-4 shrink-0 text-violet-600" />}
        {view.health === 'delayed' && <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />}
        {view.health === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />}
      </div>

      {!compact && (
        <div className="mt-2">
          <ProgressBar actual={view.actualPct} planned={view.plannedPct} color={h.color} height={7} />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span><b className="text-slate-800">{view.actualPct}%</b>{view.plannedPct !== null ? ` · plan ${view.plannedPct}%` : ''}</span>
            <span>
              {task.plannedDays ? `${view.effortToDate}/${task.plannedDays} pd` : view.effortToDate ? `${view.effortToDate} pd` : ''}
              {task.endDate ? ` · ${task.status === 'done' ? 'done' : daysLeft !== null && daysLeft < 0 ? `${-daysLeft}d over` : `due ${fmtShort(task.endDate)}`}` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {people.map(({ person, ring, loanReturn }) => (
          <PersonToken key={person.id} person={person} ring={ring} loan={loanReturn} canDrag={canEdit} fromTaskId={task.id} onOpen={() => onOpenPerson(person)} />
        ))}
        {Array.from({ length: slots }).map((_, i) => (
          <div key={i} className="flex w-[52px] flex-col items-center" title="Needs one more person">
            <div className="h-[38px] w-[38px] rounded-full border-2 border-dashed border-slate-300" />
            <div className="text-[10px] text-slate-400">needed</div>
          </div>
        ))}
        {!people.length && !slots && task.status !== 'done' && <div className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] text-slate-400">{canEdit ? 'Drop a person here' : 'Nobody today'}</div>}
      </div>
    </div>
  )
}
