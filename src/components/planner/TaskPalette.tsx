import { useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical, Search } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { Task } from '../../lib/types'
import { tint } from '../../lib/colors'

function PaletteTask({ task, color, code, count, canDrag, onPick }: { task: Task; color: string; code: string; count: number; canDrag: boolean; onPick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}`, data: { kind: 'task', taskId: task.id }, disabled: !canDrag })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`mb-1 flex items-stretch overflow-hidden rounded-md border-l-4 shadow-sm ${isDragging ? 'opacity-40' : ''}`} style={{ background: tint(color, 0.88), borderLeftColor: color }}>
      <button type="button" onClick={onPick} className="min-w-0 flex-1 px-2 py-1.5 text-left nodrag">
        <div className="truncate text-[11px] font-bold" style={{ color }}>{code}<span className="ml-2 font-normal text-slate-500">{count ? `${count} d` : ''}</span></div>
        <div className="line-clamp-2 text-xs text-slate-800">{task.name}</div>
      </button>
      {canDrag && <span className="chip flex w-6 cursor-grab items-center justify-center text-slate-400"><GripVertical className="h-4 w-4" /></span>}
    </div>
  )
}

export function TaskPalette({ days, canDrag, onPick }: { days: string[]; canDrag: boolean; onPick: (taskId: string) => void }) {
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const allocations = useStore((s) => s.allocations)
  const [q, setQ] = useState('')
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of Object.values(allocations)) if (days.includes(a.date)) m[a.taskId] = (m[a.taskId] ?? 0) + 1
    return m
  }, [allocations, days])
  const term = q.trim().toLowerCase()
  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find task" className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-2 text-sm" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {projects.filter((p) => p.status !== 'closed').map((p) => {
          const list = tasks.filter((t) => t.projectId === p.id && t.status !== 'done' && (!term || `${p.code} ${t.name}`.toLowerCase().includes(term)))
          if (!list.length) return null
          return (
            <div key={p.id} className="mb-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.code} {p.name}</div>
              {list.map((t) => <PaletteTask key={t.id} task={t} color={p.color} code={p.code} count={counts[t.id] ?? 0} canDrag={canDrag} onPick={() => onPick(t.id)} />)}
            </div>
          )
        })}
        {!tasks.length && <div className="text-xs text-slate-500">No tasks yet. Add them in the Tasks page.</div>}
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{canDrag ? 'Drag a task onto a cell, or tap a task to assign it.' : 'Read-only'}</div>
    </div>
  )
}
