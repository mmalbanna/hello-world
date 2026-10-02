import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, FileDown, Share2, ClipboardCopy, Printer } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fetchAllocations } from '../lib/repo'
import { Button, Field, Input, Select, PageHeader, Spinner } from '../components/ui'
import { fmtDay, fmtDayNum, isWorkingDay, shiftKey, todayKey, weekStartKey } from '../lib/dates'
import { DEFAULT_FILTERS, type Filters } from '../lib/select'
import { PERSON_TYPE_LABEL, type PersonType } from '../lib/types'
import { buildPlan, fileStem, planToText, type PlanData } from '../export/plan'
import { canShareFiles, shareOrDownload, downloadBlob } from '../export/share'
import { tint } from '../lib/colors'
import ReportsHistory from './ReportsHistory'

type Kind = 'excel' | 'word' | 'pdf'

export default function Reports() {
  const { people, projects, tasks, settings, profile, toast } = useStore()
  const ws = weekStartKey(todayKey(), settings)
  const [start, setStart] = useState(ws)
  const [end, setEnd] = useState(shiftKey(ws, 13))
  const [title, setTitle] = useState('Resource Allocation Plan')
  const [includeNonWorking, setIncludeNonWorking] = useState(false)
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, groupBy: 'discipline' })
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<Kind | 'text' | null>(null)
  const leads = useMemo(() => people.filter((l) => people.some((p) => p.leadId === l.id)), [people])
  const share = canShareFiles()

  const preset = (k: 'week' | 'next' | '2w' | '4w' | 'month') => {
    const s = weekStartKey(todayKey(), settings)
    if (k === 'week') { setStart(s); setEnd(shiftKey(s, 6)) }
    if (k === 'next') { setStart(shiftKey(s, 7)); setEnd(shiftKey(s, 13)) }
    if (k === '2w') { setStart(s); setEnd(shiftKey(s, 13)) }
    if (k === '4w') { setStart(s); setEnd(shiftKey(s, 27)) }
    if (k === 'month') { const t = todayKey(); const m = t.slice(0, 7); const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate(); setStart(`${m}-01`); setEnd(`${m}-${String(last).padStart(2, '0')}`) }
  }

  useEffect(() => {
    if (!start || !end || end < start) return
    let cancelled = false
    setLoading(true)
    fetchAllocations(start, end).then((allocs) => {
      if (cancelled) return
      setPlan(buildPlan({ title, start, end, includeNonWorking, filters }, { people, projects, tasks, allocations: allocs, settings, generatedBy: profile?.displayName ?? '' }))
    }).catch((e) => toast((e as Error).message, 'error')).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [start, end, title, includeNonWorking, filters, people, projects, tasks, settings, profile, toast])

  const run = async (kind: Kind, mode: 'share' | 'download') => {
    if (!plan) return
    setBusy(kind)
    try {
      let blob: Blob; let ext: string
      if (kind === 'excel') { const { exportExcel } = await import('../export/excel'); blob = await exportExcel(plan); ext = 'xlsx' }
      else if (kind === 'word') { const { exportWord } = await import('../export/word'); blob = await exportWord(plan); ext = 'docx' }
      else {
        const { exportPdf } = await import('../export/pdf'); const r = await exportPdf(plan); blob = r.blob; ext = 'pdf'
        if (r.font !== 'Aptos') toast('PDF used Helvetica: add Aptos.ttf to public/fonts to embed Aptos (see README).', 'info')
      }
      const name = `${fileStem(plan)}.${ext}`
      if (mode === 'share') { const r = await shareOrDownload(blob, name, plan.title); if (r === 'downloaded') toast('Sharing is not available here, the file was downloaded instead.') }
      else downloadBlob(blob, name)
    } catch (e) { console.error(e); toast((e as Error).message, 'error') } finally { setBusy(null) }
  }

  const copyText = async () => {
    if (!plan) return
    setBusy('text')
    try {
      const txt = planToText(plan)
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
      if (share && nav.share) await nav.share({ title: plan.title, text: txt })
      else { await navigator.clipboard.writeText(txt); toast('Plain-text plan copied. Paste it into WhatsApp, Teams or email.', 'success') }
    } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error') } finally { setBusy(null) }
  }

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const [kind, setKind] = useState<'plan' | 'history'>('plan')

  return (
    <div>
      <PageHeader title="Share plan and reports" subtitle="The allocation plan for the team, or the history and progress report for management." />
      <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        <button className={`flex-1 rounded-md px-3 py-1.5 font-medium ${kind === 'plan' ? 'bg-white shadow-sm text-brand' : 'text-slate-600'}`} onClick={() => setKind('plan')}>Allocation plan</button>
        <button className={`flex-1 rounded-md px-3 py-1.5 font-medium ${kind === 'history' ? 'bg-white shadow-sm text-brand' : 'text-slate-600'}`} onClick={() => setKind('history')}>History and progress</button>
      </div>
      {kind === 'history' ? <ReportsHistory /> : <>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_1fr_auto]">
        <Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Quick ranges" group>
          <div className="flex flex-wrap gap-1">
            {([['week', 'This week'], ['next', 'Next week'], ['2w', '2 weeks'], ['4w', '4 weeks'], ['month', 'This month']] as const).map(([k, l]) => <Button key={k} variant="ghost" className="border border-slate-200" onClick={() => preset(k)}>{l}</Button>)}
          </div>
        </Field>
        <Field label="Document title" className="md:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={includeNonWorking} onChange={(e) => setIncludeNonWorking(e.target.checked)} /> Include non-working days</label>
        <div className="grid grid-cols-2 gap-2 md:col-span-3 md:grid-cols-5">
          <Select value={filters.projectId} onChange={(e) => setF({ projectId: e.target.value })}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select>
          <Select value={filters.discipline} onChange={(e) => setF({ discipline: e.target.value })}><option value="">All disciplines</option>{settings.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
          <Select value={filters.leadId} onChange={(e) => setF({ leadId: e.target.value })}><option value="">All team leads</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select value={filters.type} onChange={(e) => setF({ type: e.target.value as '' | PersonType })}><option value="">All types</option>{(Object.keys(PERSON_TYPE_LABEL) as PersonType[]).map((t) => <option key={t} value={t}>{PERSON_TYPE_LABEL[t]}</option>)}</Select>
          <Select value={filters.groupBy} onChange={(e) => setF({ groupBy: e.target.value as Filters['groupBy'] })}><option value="discipline">Group by discipline</option><option value="lead">Group by team lead</option><option value="none">No grouping</option></Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {([['excel', 'Excel', FileSpreadsheet], ['word', 'Word', FileText], ['pdf', 'PDF', FileDown]] as const).map(([k, l, Icon]) => (
          <div key={k} className="flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
            <button disabled={!plan || !!busy} onClick={() => run(k, share ? 'share' : 'download')} className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
              <Icon className="h-4 w-4 text-brand" /> {busy === k ? 'Preparing…' : l}{share ? <Share2 className="h-3.5 w-3.5 text-slate-400" /> : null}
            </button>
            {share && <button disabled={!plan || !!busy} onClick={() => run(k, 'download')} className="border-l border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50" title="Save file instead of sharing">Save</button>}
          </div>
        ))}
        <Button onClick={copyText} disabled={!plan || !!busy}><ClipboardCopy className="h-4 w-4" /> {share ? 'Share as text' : 'Copy as text'}</Button>
        <Button onClick={() => window.print()} disabled={!plan} className="hidden md:inline-flex"><Printer className="h-4 w-4" /> Print</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Documents are authored as {`"Motasem Albanna"`} in the Aptos font. {share ? 'On this device the buttons open the share sheet (WhatsApp, Teams, Mail…).' : ''}</p>

      <div className="mt-4">
        {loading && !plan ? <Spinner label="Loading allocations" /> : plan && (
          <div className="grid-scroll overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-1 text-left">Person ({plan.people.length})</th>
                  {plan.days.map((d) => <th key={d} className={`min-w-[80px] border-b border-r border-slate-200 px-1 py-1 text-center ${isWorkingDay(d, settings) ? '' : 'bg-slate-100 text-slate-400'}`}>{fmtDay(d)} {fmtDayNum(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {plan.groups.map((g) => (
                  <GroupBlock key={g.key} label={g.label} span={plan.days.length + 1}>
                    {g.people.map((p) => (
                      <tr key={p.id}>
                        <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-2 py-1 text-left font-medium">{p.name}</th>
                        {plan.days.map((d) => {
                          const c = plan.cell(p.id, d)
                          return <td key={d} className={`border-b border-r border-slate-200 px-1 py-1 align-top ${!c && !isWorkingDay(d, settings) ? 'bg-slate-100' : ''}`} style={c ? { background: tint(c.project?.color ?? '#64748b', 0.86) } : undefined}>{c && <><div className="font-bold" style={{ color: c.project?.color }}>{c.project?.code}</div><div className="line-clamp-2">{c.task?.name}</div></>}</td>
                        })}
                      </tr>
                    ))}
                  </GroupBlock>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}
    </div>
  )
}

function GroupBlock({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return <>{label && <tr><td colSpan={span} className="border-b border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{label}</td></tr>}{children}</>
}
