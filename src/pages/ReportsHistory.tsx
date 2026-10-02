import { useState } from 'react'
import { FileSpreadsheet, FileText, FileDown, Share2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fetchAllLoans, fetchAllocations, fetchEvents } from '../lib/repo'
import { Button, Field, Input, Select } from '../components/ui'
import { shiftKey, todayKey } from '../lib/dates'
import { buildHistoryReport } from '../export/history'
import { reportToExcel, reportToPdf, reportToWord, type ReportDoc } from '../export/report'
import { canShareFiles, downloadBlob, shareOrDownload } from '../export/share'

export default function ReportsHistory() {
  const { people, projects, tasks, settings, profile, toast } = useStore()
  const [start, setStart] = useState(shiftKey(todayKey(), -28))
  const [end, setEnd] = useState(todayKey())
  const [projectFilter, setProjectFilter] = useState('')
  const [doc, setDoc] = useState<ReportDoc | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const share = canShareFiles()

  const generate = async () => {
    if (!start || !end || end < start) { toast('Check the dates', 'error'); return }
    setBusy('build')
    try {
      const [events, allocations, loans] = await Promise.all([fetchEvents(start, end), fetchAllocations(shiftKey(start, -120), shiftKey(end, 120)), fetchAllLoans()])
      setDoc(buildHistoryReport({ start, end, people, projects, tasks, allocations, events, loans, settings, generatedBy: profile?.displayName ?? '', projectFilter: projectFilter || undefined }))
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(null) }
  }

  const exportAs = async (kind: 'excel' | 'word' | 'pdf', mode: 'share' | 'download') => {
    if (!doc) return
    setBusy(kind)
    try {
      let blob: Blob; let ext: string
      if (kind === 'excel') { blob = await reportToExcel(doc); ext = 'xlsx' }
      else if (kind === 'word') { blob = await reportToWord(doc); ext = 'docx' }
      else { const r = await reportToPdf(doc); blob = r.blob; ext = 'pdf'; if (r.font !== 'Aptos') toast('PDF used Helvetica: add Aptos.ttf to public/fonts to embed Aptos.', 'info') }
      const name = `${settings.orgName.replace(/[^\w]+/g, '_')}_History_${start}_to_${end}.${ext}`
      if (mode === 'share') { const r = await shareOrDownload(blob, name, doc.title); if (r === 'downloaded') toast('Sharing is not available here, the file was downloaded instead.') }
      else downloadBlob(blob, name)
    } catch (e) { console.error(e); toast((e as Error).message, 'error') } finally { setBusy(null) }
  }

  const preset = (k: 'week' | 'month' | 'quarter') => { const t = todayKey(); setEnd(t); setStart(shiftKey(t, k === 'week' ? -7 : k === 'month' ? -30 : -90)) }

  return (
    <div>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="From"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Project"><Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
        <Field label="Quick ranges" group><div className="flex gap-1">{([['week', 'Last 7 days'], ['month', 'Last 30 days'], ['quarter', 'Last 90 days']] as const).map(([k, l]) => <Button key={k} variant="ghost" className="border border-slate-200" onClick={() => preset(k)}>{l}</Button>)}</div></Field>
        <div className="md:col-span-4"><Button variant="primary" busy={busy === 'build'} onClick={generate}>Generate report</Button></div>
      </div>

      {doc && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {([['excel', 'Excel', FileSpreadsheet], ['word', 'Word', FileText], ['pdf', 'PDF', FileDown]] as const).map(([k, l, Icon]) => (
              <div key={k} className="flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                <button disabled={!!busy} onClick={() => exportAs(k, share ? 'share' : 'download')} className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"><Icon className="h-4 w-4 text-brand" /> {busy === k ? 'Preparing…' : l}{share ? <Share2 className="h-3.5 w-3.5 text-slate-400" /> : null}</button>
                {share && <button disabled={!!busy} onClick={() => exportAs(k, 'download')} className="border-l border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50">Save</button>}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold text-brand">{doc.title}</h2>
            <div className="text-sm text-slate-600">{doc.subtitle}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {doc.kpis.map((k) => <div key={k.label} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-xl font-bold" style={{ color: k.color ?? '#0f4c81' }}>{k.value}</div><div className="text-[10px] uppercase tracking-wide text-slate-500">{k.label}</div></div>)}
            </div>
            {doc.sections.map((s) => (
              <div key={s.heading} className="mt-5">
                <h3 className="font-semibold text-slate-900">{s.heading} <span className="text-xs font-normal text-slate-400">{s.table ? `${s.table.rows.length} rows` : ''}</span></h3>
                {s.text && <p className="text-xs text-slate-500">{s.text}</p>}
                {s.table && s.table.rows.length > 0 && (
                  <div className="grid-scroll mt-1 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr>{s.table.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1">{c}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {s.table.rows.slice(0, 10).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="max-w-[260px] truncate px-2 py-1" style={j === 0 && s.table!.rowColors?.[i] ? { color: s.table!.rowColors![i]!, fontWeight: 600 } : undefined}>{v === null ? '' : String(v)}</td>)}</tr>)}
                      </tbody>
                    </table>
                    {s.table.rows.length > 10 && <div className="px-2 py-1 text-[10px] text-slate-400">and {s.table.rows.length - 10} more rows in the export</div>}
                  </div>
                )}
                {s.table && !s.table.rows.length && <div className="mt-1 text-xs text-slate-400">Nothing in this period.</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
