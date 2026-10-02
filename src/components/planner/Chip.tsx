import { useDraggable } from '@dnd-kit/core'
import { GripVertical, StickyNote } from 'lucide-react'
import type { Allocation, Project, Task } from '../../lib/types'
import { tint } from '../../lib/colors'

export function ChipBody({ project, task, note, ghost, compact }: { project?: Project; task?: Task; note?: string; ghost?: boolean; compact?: boolean }) {
  const color = project?.color ?? '#64748b'
  return (
    <div
      className={`flex h-full min-h-[44px] w-full items-stretch overflow-hidden rounded-md border-l-4 text-left shadow-sm ${ghost ? 'opacity-90 ring-2 ring-brand' : ''}`}
      style={{ background: tint(color, 0.86), borderLeftColor: color }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center px-1.5 py-1 leading-tight">
        <div className="truncate text-[11px] font-bold" style={{ color }}>{project?.code ?? '—'}{note ? <StickyNote className="ml-1 inline h-3 w-3 text-slate-500" /> : null}</div>
        {!compact && <div className="line-clamp-2 text-[11px] text-slate-800">{task?.name ?? 'Unknown task'}</div>}
      </div>
    </div>
  )
}

export function Chip({ alloc, project, task, canDrag, onOpen }: { alloc: Allocation; project?: Project; task?: Task; canDrag: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `alloc:${alloc.id}`,
    data: { kind: 'alloc', alloc },
    disabled: !canDrag,
  })
  return (
    <div ref={setNodeRef} className={`relative h-full ${isDragging ? 'opacity-30' : ''}`} {...attributes} {...listeners}>
      <button type="button" className="block h-full w-full nodrag" onClick={onOpen} aria-label={`${project?.code ?? ''} ${task?.name ?? ''}`}>
        <ChipBody project={project} task={task} note={alloc.note} />
      </button>
      {canDrag && (
        <span className="chip absolute inset-y-0 right-0 flex w-5 cursor-grab items-center justify-center text-slate-400/80 active:cursor-grabbing" title="Drag to move">
          <GripVertical className="h-4 w-4" />
        </span>
      )}
    </div>
  )
}
