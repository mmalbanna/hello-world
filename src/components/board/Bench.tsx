import { useDroppable } from '@dnd-kit/core'
import type { Person } from '../../lib/types'
import { PersonToken } from './PersonToken'

export function Bench({ groups, canEdit, onOpenPerson, horizontal }: { groups: { label: string; color: string; people: Person[] }[]; canEdit: boolean; onOpenPerson: (p: Person) => void; horizontal?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'bench', data: { bench: true }, disabled: !canEdit })
  const total = groups.reduce((n, g) => n + g.people.length, 0)
  return (
    <div ref={setNodeRef} className={`rounded-xl border bg-white p-2 ${isOver ? 'ring-2 ring-brand border-brand bg-brand/5' : 'border-slate-200'} ${horizontal ? '' : 'h-full overflow-y-auto'}`}>
      <div className="mb-1 flex items-center justify-between px-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available</div>
        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${total ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{total}</span>
      </div>
      {!total && <div className="px-1 py-2 text-[11px] text-slate-400">Everyone is on a task{canEdit ? '. Drop someone here to free them.' : '.'}</div>}
      <div className={horizontal ? 'flex gap-3 overflow-x-auto pb-1' : 'space-y-2'}>
        {groups.map((g) => (
          <div key={g.label} className={horizontal ? 'shrink-0' : ''}>
            <div className="mb-0.5 flex items-center gap-1 px-1 text-[10px] font-semibold text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: g.color }} />{g.label}</div>
            <div className="flex flex-wrap gap-1">
              {g.people.map((p) => <PersonToken key={p.id} person={p} ring={g.color} canDrag={canEdit} fromTaskId={null} onOpen={() => onOpenPerson(p)} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
