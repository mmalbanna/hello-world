import { useState } from 'react'
import { Plus } from 'lucide-react'
import { quickAddTask } from '../../lib/repo'
import { useStore } from '../../store/useStore'
import { addWorkingDays, nextWorkingDay } from '../../lib/progress'
import { todayKey } from '../../lib/dates'

export function QuickAdd({ projectId, color }: { projectId: string; color: string }) {
  const { settings, toast } = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [due, setDue] = useState('')
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await quickAddTask(projectId, name.trim(), { startDate: nextWorkingDay(todayKey(), settings), endDate: due || null, plannedDays: days ? Number(days) : null })
      setName(''); setDue(''); setDays(''); setOpen(false)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  if (!open) return <button onClick={() => { setOpen(true); setDue(addWorkingDays(nextWorkingDay(todayKey(), settings), 9, settings)) }} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"><Plus className="h-4 w-4" /> New task</button>
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm" style={{ borderLeftWidth: 5, borderLeftColor: color }}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false) }} placeholder="Task name" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <label className="text-[10px] text-slate-500">Due<input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 text-xs" /></label>
        <label className="text-[10px] text-slate-500">Person-days<input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 text-xs" /></label>
      </div>
      <div className="mt-1.5 flex justify-end gap-1">
        <button className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => setOpen(false)}>Cancel</button>
        <button className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50" disabled={busy || !name.trim()} onClick={save}>Add</button>
      </div>
    </div>
  )
}
