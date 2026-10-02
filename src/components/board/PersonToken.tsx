import { useDraggable } from '@dnd-kit/core'
import type { Person } from '../../lib/types'
import { Avatar } from '../Avatar'

export function PersonToken({ person, ring, loan, canDrag, fromTaskId, onOpen, size = 38, label }: { person: Person; ring: string; loan?: string | null; canDrag: boolean; fromTaskId: string | null; onOpen: () => void; size?: number; label?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `person:${person.id}:${fromTaskId ?? 'bench'}`, data: { personId: person.id, fromTaskId }, disabled: !canDrag })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`chip flex w-[52px] flex-col items-center gap-0.5 ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30' : ''}`} onClick={(e) => { e.stopPropagation(); onOpen() }} role="button" aria-label={person.name}>
      <Avatar person={person} size={size} ring={ring} loan={!!loan} title={loan ? `${person.name} (on loan, returns ${loan})` : person.name} />
      {label !== false && <div className="w-full truncate text-center text-[10px] leading-tight text-slate-700">{person.name.split(' ')[0]}</div>}
    </div>
  )
}
