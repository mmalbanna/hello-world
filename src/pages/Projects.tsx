import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { upsertProject, deleteProject } from '../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea, PageHeader, Empty, Badge, confirmDialog } from '../components/ui'
import { PROJECT_STATUS_LABEL, type Project, type ProjectStatus } from '../lib/types'
import { PROJECT_PALETTE, nextProjectColor } from '../lib/colors'

type Form = Omit<Project, 'id' | 'order'>

export default function Projects() {
  const { projects, tasks, toast } = useStore()
  const isAdmin = useStore((s) => s.isAdmin)()
  const [editing, setEditing] = useState<{ id?: string; form: Form } | null>(null)
  const [busy, setBusy] = useState(false)

  const blank = (): Form => ({ code: '', name: '', client: '', color: nextProjectColor(projects.map((p) => p.color)), status: 'active', notes: '' })
  const open = (p?: Project) => setEditing(p ? { id: p.id, form: { code: p.code, name: p.name, client: p.client, color: p.color, status: p.status, notes: p.notes } } : { form: blank() })

  const save = async () => {
    if (!editing) return
    if (!editing.form.code.trim() || !editing.form.name.trim()) { toast('Code and name are required', 'error'); return }
    setBusy(true)
    try { await upsertProject(editing.form, editing.id); setEditing(null) } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (p: Project) => {
    const n = tasks.filter((t) => t.projectId === p.id).length
    if (!confirmDialog(`Delete ${p.code} ${p.name}? This also deletes its ${n} task(s) and every allocation on them.`)) return
    try { await deleteProject(p.id) } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div>
      <PageHeader title="Projects" subtitle="Each project has a colour that is used everywhere in the plan." actions={isAdmin && <Button variant="primary" onClick={() => open()}><Plus className="h-4 w-4" /> Add project</Button>} />
      {!projects.length ? <Empty title="No projects yet" text="Add P820, P860, P875, P880 and the ones coming down the line." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const n = tasks.filter((t) => t.projectId === p.id)
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTopColor: p.color, borderTopWidth: 4 }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold" style={{ color: p.color }}>{p.code}</div>
                    <div className="font-medium text-slate-900">{p.name}</div>
                    {p.client && <div className="text-sm text-slate-500">{p.client}</div>}
                  </div>
                  <Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                </div>
                <div className="mt-2 text-xs text-slate-500">{n.length} tasks · {n.filter((t) => t.status === 'done').length} done</div>
                {p.notes && <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{p.notes}</div>}
                {isAdmin && (
                  <div className="mt-3 flex gap-2">
                    <Button variant="ghost" onClick={() => open(p)}><Pencil className="h-4 w-4" /> Edit</Button>
                    <Button variant="ghost" className="text-red-600" onClick={() => remove(p)}><Trash2 className="h-4 w-4" /> Delete</Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit project' : 'Add project'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code"><Input value={editing.form.code} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, code: e.target.value.toUpperCase() } })} placeholder="P820" /></Field>
              <Field label="Name" className="col-span-2"><Input value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} placeholder="Qatar Central Bank" /></Field>
            </div>
            <Field label="Client"><Input value={editing.form.client} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, client: e.target.value } })} /></Field>
            <Field label="Status"><Select value={editing.form.status} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, status: e.target.value as ProjectStatus } })}>{(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</Select></Field>
            <Field label="Colour">
              <div className="flex flex-wrap gap-2">
                {PROJECT_PALETTE.map((c) => <button key={c} type="button" onClick={() => setEditing({ ...editing, form: { ...editing.form, color: c } })} className={`h-8 w-8 rounded-full ${editing.form.color === c ? 'ring-2 ring-offset-2 ring-slate-800' : ''}`} style={{ background: c }} aria-label={c} />)}
              </div>
            </Field>
            <Field label="Notes"><Textarea value={editing.form.notes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, notes: e.target.value } })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  )
}
