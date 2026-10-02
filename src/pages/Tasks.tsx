import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { upsertTask, deleteTask } from '../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea, PageHeader, Empty, Badge, confirmDialog } from '../components/ui'
import { PRIORITY_LABEL, TASK_STATUS_LABEL, type Priority, type Task, type TaskStatus } from '../lib/types'
import { consecutiveRuns, fmtShort } from '../lib/dates'

type Form = Omit<Task, 'id' | 'order'>

export default function Tasks() {
  const { projects, tasks, people, allocations, settings, toast } = useStore()
  const canEdit = useStore((s) => s.canEdit)()
  const [projectFilter, setProjectFilter] = useState('')
  const [hideDone, setHideDone] = useState(true)
  const [editing, setEditing] = useState<{ id?: string; form: Form } | null>(null)
  const [busy, setBusy] = useState(false)

  const blank = (): Form => ({ projectId: projectFilter || projects[0]?.id || '', name: '', discipline: '', startDate: null, endDate: null, status: 'open', priority: 'normal', notes: '', headcount: null })
  const open = (t?: Task) => setEditing(t ? { id: t.id, form: { ...t } } : { form: blank() })

  // who is on which task in the loaded window (upcoming assignments)
  const assigned = useMemo(() => {
    const m: Record<string, { personId: string; dates: string[] }[]> = {}
    const byTaskPerson: Record<string, string[]> = {}
    for (const a of Object.values(allocations)) {
      const k = `${a.taskId}|${a.personId}`
      ;(byTaskPerson[k] ??= []).push(a.date)
    }
    for (const [k, dates] of Object.entries(byTaskPerson)) {
      const [taskId, personId] = k.split('|')
      ;(m[taskId] ??= []).push({ personId, dates })
    }
    return m
  }, [allocations])

  const save = async () => {
    if (!editing) return
    if (!editing.form.name.trim() || !editing.form.projectId) { toast('Project and task name are required', 'error'); return }
    setBusy(true)
    try { await upsertTask(editing.form, editing.id); setEditing(null) } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (t: Task) => {
    if (!confirmDialog(`Delete task "${t.name}" and all its allocations?`)) return
    try { await deleteTask(t.id) } catch (e) { toast((e as Error).message, 'error') }
  }

  const list = tasks.filter((t) => (!projectFilter || t.projectId === projectFilter) && (!hideDone || t.status !== 'done'))
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '?'

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Tasks come and go; keep this list current and allocate people to them in the planner." actions={canEdit && <Button variant="primary" onClick={() => open()} disabled={!projects.length}><Plus className="h-4 w-4" /> Add task</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select compact value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="min-w-[200px]"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done</label>
      </div>
      {!projects.length ? <Empty title="Add a project first" /> : !list.length ? <Empty title="No tasks" text="Add the first task for this project." /> : (
        <div className="space-y-2">
          {projects.filter((p) => !projectFilter || p.id === projectFilter).map((p) => {
            const pt = list.filter((t) => t.projectId === p.id)
            if (!pt.length) return null
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-sm font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: p.color }} />{p.code} · {p.name}</div>
                <ul className="divide-y divide-slate-100">
                  {pt.map((t) => (
                    <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{t.name}</span>
                          <Badge>{TASK_STATUS_LABEL[t.status]}</Badge>
                          {t.priority !== 'normal' && <Badge color={t.priority === 'urgent' ? '#dc2626' : t.priority === 'high' ? '#f59e0b' : '#94a3b8'}>{PRIORITY_LABEL[t.priority]}</Badge>}
                          {t.discipline && <span className="text-xs text-slate-500">{t.discipline}</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {t.startDate || t.endDate ? `${t.startDate ? fmtShort(t.startDate) : '…'} → ${t.endDate ? fmtShort(t.endDate) : '…'}` : 'No dates'}
                          {t.headcount ? ` · needs ${t.headcount}/day` : ''}
                        </div>
                        {assigned[t.id]?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {assigned[t.id].map((a) => (
                              <span key={a.personId} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={consecutiveRuns(a.dates).map((r) => `${fmtShort(r[0])}–${fmtShort(r[r.length - 1])}`).join(', ')}>{personName(a.personId)} · {a.dates.length}d</span>
                            ))}
                          </div>
                        ) : <div className="mt-1 text-xs text-amber-700">Nobody allocated in the loaded window</div>}
                        {t.notes && <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t.notes}</div>}
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" onClick={() => open(t)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" className="text-red-600" onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit task' : 'Add task'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {editing && (() => {
          const f = editing.form
          const set = (patch: Partial<Form>) => setEditing({ ...editing, form: { ...f, ...patch } })
          return (
            <div className="space-y-3">
              <Field label="Project"><Select value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select></Field>
              <Field label="Task name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. LOD 400 architectural model - Tower" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Discipline"><Select value={f.discipline} onChange={(e) => set({ discipline: e.target.value })}><option value="">Any</option>{settings.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
                <Field label="People needed per day"><Input type="number" min={0} value={f.headcount ?? ''} onChange={(e) => set({ headcount: e.target.value ? Number(e.target.value) : null })} /></Field>
                <Field label="Start"><Input type="date" value={f.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || null })} /></Field>
                <Field label="End"><Input type="date" value={f.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} /></Field>
                <Field label="Status"><Select value={f.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>{(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</Select></Field>
                <Field label="Priority"><Select value={f.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>{(Object.keys(PRIORITY_LABEL) as Priority[]).map((s) => <option key={s} value={s}>{PRIORITY_LABEL[s]}</option>)}</Select></Field>
              </div>
              <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          )
        })()}
      </Dialog>
    </div>
  )
}
