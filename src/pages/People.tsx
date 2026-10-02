import { useState } from 'react'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { useStore } from '../store/useStore'
import { upsertPerson, deletePerson, reorderPeople } from '../lib/repo'
import { Button, Dialog, Field, Input, Select, Textarea, PageHeader, Empty, Badge, confirmDialog } from '../components/ui'
import { PERSON_TYPE_LABEL, type Person, type PersonType } from '../lib/types'

type Form = Omit<Person, 'id' | 'order'>

export default function People() {
  const { people, settings, toast } = useStore()
  const isAdmin = useStore((s) => s.isAdmin)()
  const [editing, setEditing] = useState<{ id?: string; form: Form } | null>(null)
  const [busy, setBusy] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const blank = (): Form => ({ name: '', title: settings.titles[0] ?? 'BIM Modeler', discipline: settings.disciplines[0] ?? '', type: 'employee', leadId: null, email: '', active: true, notes: '' })
  const open = (p?: Person) => setEditing(p ? { id: p.id, form: { ...p } } : { form: blank() })
  const leads = people.filter((p) => /lead|manager|coordinator/i.test(p.title) || people.some((x) => x.leadId === p.id))

  const save = async () => {
    if (!editing || !editing.form.name.trim()) { toast('Name is required', 'error'); return }
    setBusy(true)
    try { await upsertPerson(editing.form, editing.id); setEditing(null) } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (p: Person) => {
    if (!confirmDialog(`Remove ${p.name} and all their allocations? Consider marking them inactive instead.`)) return
    try { await deletePerson(p.id) } catch (e) { toast((e as Error).message, 'error') }
  }
  const move = async (p: Person, dir: -1 | 1) => {
    const ids = people.map((x) => x.id)
    const i = ids.indexOf(p.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    try { await reorderPeople(ids) } catch (e) { toast((e as Error).message, 'error') }
  }

  const list = people.filter((p) => showInactive || p.active)
  const leadName = (id: string | null) => people.find((p) => p.id === id)?.name ?? ''

  return (
    <div>
      <PageHeader title="People" subtitle="Your team, subcontractors and supply chain. Order here is the order in the planner." actions={isAdmin && <Button variant="primary" onClick={() => open()}><Plus className="h-4 w-4" /> Add person</Button>} />
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
      {!list.length ? <Empty title="No people yet" text="Add your team leads first (Raja, Gloria, Suresh …), then the modelers under each lead." /> : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Name</th><th className="hidden px-3 py-2 sm:table-cell">Title</th><th className="px-3 py-2">Discipline</th><th className="hidden px-3 py-2 md:table-cell">Team lead</th><th className="hidden px-3 py-2 md:table-cell">Type</th>{isAdmin && <th className="px-3 py-2"></th>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="px-3 py-2"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500 sm:hidden">{p.title}</div>{p.email && <div className="text-xs text-slate-400">{p.email}</div>}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{p.title}</td>
                  <td className="px-3 py-2">{p.discipline}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{leadName(p.leadId)}</td>
                  <td className="hidden px-3 py-2 md:table-cell"><Badge>{PERSON_TYPE_LABEL[p.type]}</Badge></td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button variant="ghost" onClick={() => move(p, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" onClick={() => move(p, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                      <Button variant="ghost" onClick={() => open(p)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" className="text-red-600" onClick={() => remove(p)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit person' : 'Add person'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {editing && (() => {
          const f = editing.form
          const set = (patch: Partial<Form>) => setEditing({ ...editing, form: { ...f, ...patch } })
          return (
            <div className="space-y-3">
              <Field label="Name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title"><Select value={f.title} onChange={(e) => set({ title: e.target.value })}>{[...new Set([...settings.titles, f.title])].filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                <Field label="Discipline"><Select value={f.discipline} onChange={(e) => set({ discipline: e.target.value })}><option value="">—</option>{[...new Set([...settings.disciplines, f.discipline])].filter(Boolean).map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
                <Field label="Type"><Select value={f.type} onChange={(e) => set({ type: e.target.value as PersonType })}>{(Object.keys(PERSON_TYPE_LABEL) as PersonType[]).map((t) => <option key={t} value={t}>{PERSON_TYPE_LABEL[t]}</option>)}</Select></Field>
                <Field label="Team lead"><Select value={f.leadId ?? ''} onChange={(e) => set({ leadId: e.target.value || null })}><option value="">None (is a lead / reports to you)</option>{leads.filter((l) => l.id !== editing.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
              </div>
              <Field label="Email (optional)" hint="Matches their sign-in so their own row is highlighted."><Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Active (shown in the planner)</label>
              <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          )
        })()}
      </Dialog>
    </div>
  )
}
