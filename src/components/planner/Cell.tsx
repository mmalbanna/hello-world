import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

export function Cell({ personId, date, working, today, canEdit, empty, onAdd, children }: {
  personId: string; date: string; working: boolean; today: boolean; canEdit: boolean; empty: boolean; onAdd: () => void; children?: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${personId}:${date}`, data: { personId, date }, disabled: !canEdit })
  return (
    <td
      ref={setNodeRef}
      className={`h-[52px] min-w-[96px] border-b border-r border-slate-200 p-0.5 align-top ${working ? '' : 'bg-slate-100/80'} ${today ? 'bg-amber-50' : ''} ${isOver ? 'ring-2 ring-inset ring-brand bg-brand/5' : ''}`}
    >
      {empty ? (
        canEdit ? (
          <button type="button" onClick={onAdd} className="group flex h-full min-h-[44px] w-full items-center justify-center rounded-md text-slate-300 hover:bg-white hover:text-brand" aria-label="Assign">
            <Plus className="h-4 w-4 opacity-0 group-hover:opacity-100" />
          </button>
        ) : null
      ) : children}
    </td>
  )
}
