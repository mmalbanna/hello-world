import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import type { PlanData } from './plan'
import { AUTHOR, FONT } from './plan'
import { fmtDay, fmtDayNum, fmtShort, isWorkingDay } from '../lib/dates'
import { hexToRgb } from '../lib/colors'

let fontState: { name: string; loaded: boolean } | null = null

/** Embed Aptos if the TTF files were placed in public/fonts (see README); otherwise Helvetica. */
async function ensureFont(doc: jsPDF): Promise<string> {
  if (fontState) {
    if (fontState.loaded) await registerFromCache(doc)
    return fontState.name
  }
  try {
    const base = import.meta.env.BASE_URL
    const [reg, bold] = await Promise.all([fetchB64(`${base}fonts/Aptos.ttf`), fetchB64(`${base}fonts/Aptos-Bold.ttf`)])
    if (!reg) throw new Error('no font')
    cache = { reg, bold: bold ?? reg }
    fontState = { name: FONT, loaded: true }
    await registerFromCache(doc)
    return FONT
  } catch {
    fontState = { name: 'helvetica', loaded: false }
    return 'helvetica'
  }
}
let cache: { reg: string; bold: string } | null = null
async function registerFromCache(doc: jsPDF) {
  if (!cache) return
  doc.addFileToVFS('Aptos.ttf', cache.reg)
  doc.addFont('Aptos.ttf', FONT, 'normal')
  doc.addFileToVFS('Aptos-Bold.ttf', cache.bold)
  doc.addFont('Aptos-Bold.ttf', FONT, 'bold')
}
async function fetchB64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const ct = r.headers.get('content-type') ?? ''
    if (ct.includes('text/html')) return null
    const buf = await r.arrayBuffer()
    if (buf.byteLength < 10_000) return null
    let s = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
    return btoa(s)
  } catch {
    return null
  }
}

export async function exportPdf(plan: PlanData): Promise<{ blob: Blob; font: string }> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const font = await ensureFont(doc)
  doc.setProperties({ title: plan.title, author: AUTHOR, creator: AUTHOR, subject: `${plan.orgName} resource allocation ${plan.periodLabel}` })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 10

  doc.setFont(font, 'bold'); doc.setFontSize(16); doc.setTextColor(15, 76, 129)
  doc.text(plan.title, margin, 14)
  doc.setFont(font, 'normal'); doc.setFontSize(10); doc.setTextColor(30, 41, 59)
  doc.text(`${plan.orgName} · ${plan.periodLabel}`, margin, 20)
  doc.setFontSize(8); doc.setTextColor(100, 116, 139)
  doc.text(`Prepared by ${AUTHOR} · generated ${format(plan.generatedAt, 'd MMM yyyy HH:mm')} by ${plan.generatedBy}`, margin, 24.5)

  // legend
  let lx = margin; const ly = 29
  doc.setFontSize(8)
  for (const p of plan.projects.filter((x) => x.status !== 'closed')) {
    const [r, g, b] = hexToRgb(p.color)
    doc.setFillColor(r, g, b); doc.rect(lx, ly - 2.6, 3, 3, 'F')
    doc.setTextColor(30, 41, 59); doc.setFont(font, 'bold'); doc.text(p.code, lx + 4, ly)
    doc.setFont(font, 'normal'); const codeW = doc.getTextWidth(p.code + ' ')
    doc.text(p.name, lx + 4 + codeW, ly)
    lx += 4 + codeW + doc.getTextWidth(p.name) + 6
    if (lx > pageW - 40) break
  }

  let y = 33
  for (const week of plan.weeks) {
    const head = [['Person', ...week.map((d) => `${fmtDay(d)} ${fmtDayNum(d)}`)]]
    const body: string[][] = []
    const meta: Record<number, { group?: boolean; cells: ({ color: string } | null)[] }> = {}
    for (const g of plan.groups) {
      if (g.label) { meta[body.length] = { group: true, cells: [] }; body.push([g.label.toUpperCase(), ...week.map(() => '')]) }
      for (const p of g.people) {
        const cells = week.map((d) => plan.cell(p.id, d))
        meta[body.length] = { cells: cells.map((c) => (c ? { color: c.project?.color ?? '#64748b' } : null)) }
        body.push([`${p.name}\n${p.title}`, ...cells.map((c) => (c ? `${c.project?.code ?? ''}\n${c.task?.name ?? ''}` : ''))])
      }
    }
    autoTable(doc, {
      startY: y,
      head,
      body,
      margin: { left: margin, right: margin },
      styles: { font, fontSize: 7, cellPadding: 1.2, lineColor: [208, 213, 221], lineWidth: 0.2, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [15, 76, 129], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold', halign: 'left' } },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index > 0) {
          const d = week[data.column.index - 1]
          if (!isWorkingDay(d, plan.settings)) { data.cell.styles.fillColor = [71, 85, 105]; data.cell.styles.textColor = [203, 213, 225] }
        }
        if (data.section !== 'body') return
        const m = meta[data.row.index]
        if (m?.group) {
          data.cell.styles.fillColor = [226, 232, 240]; data.cell.styles.textColor = [71, 85, 105]; data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 6.5
          if (data.column.index > 0) data.cell.text = ['']
          return
        }
        if (data.column.index === 0) return
        const c = m?.cells[data.column.index - 1]
        if (c) {
          const [r, g, b] = hexToRgb(c.color)
          const t = (v: number) => Math.round(v + (255 - v) * 0.85)
          data.cell.styles.fillColor = [t(r), t(g), t(b)]
        } else if (!isWorkingDay(week[data.column.index - 1], plan.settings)) {
          data.cell.styles.fillColor = [241, 245, 249]
        }
      },
      didDrawCell: (data) => {
        // colour the project code line
        if (data.section !== 'body' || data.column.index === 0) return
        const c = meta[data.row.index]?.cells[data.column.index - 1]
        if (!c || !data.cell.text[0]) return
        const [r, g, b] = hexToRgb(c.color)
        doc.setFont(font, 'bold'); doc.setFontSize(7); doc.setTextColor(r, g, b)
        doc.text(data.cell.text[0], data.cell.x + 1.2, data.cell.y + 3.2)
      },
      willDrawCell: (data) => {
        if (data.section === 'body' && data.column.index > 0 && meta[data.row.index]?.cells[data.column.index - 1]) data.cell.text[0] = data.cell.text[0] ? ' ' : ''
      },
      didDrawPage: () => {
        doc.setFont(font, 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184)
        doc.text(`${plan.title} · ${plan.periodLabel} · page ${doc.getNumberOfPages()}`, margin, doc.internal.pageSize.getHeight() - 5)
      },
    })
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
    if (y > doc.internal.pageSize.getHeight() - 40 && week !== plan.weeks[plan.weeks.length - 1]) { doc.addPage(); y = 12 }
  }

  // by project
  const rows: string[][] = []
  for (const e of plan.byProject) for (const t of e.tasks) for (const pp of t.people) {
    rows.push([`${e.project.code} ${e.project.name}`, t.task.name, pp.person.name, pp.runs.map((r) => (r.length === 1 ? fmtShort(r[0]) : `${fmtShort(r[0])} to ${fmtShort(r[r.length - 1])}`)).join(', '), String(pp.days)])
  }
  if (rows.length) {
    if (y > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = 12 }
    doc.setFont(font, 'bold'); doc.setFontSize(11); doc.setTextColor(15, 76, 129)
    doc.text('Allocation by project', margin, y + 2)
    autoTable(doc, {
      startY: y + 5,
      head: [['Project', 'Task', 'Person', 'Dates', 'Days']],
      body: rows,
      margin: { left: margin, right: margin },
      styles: { font, fontSize: 8, cellPadding: 1.5, lineColor: [208, 213, 221], lineWidth: 0.2 },
      headStyles: { fillColor: [15, 76, 129], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' }, 1: { cellWidth: 80 }, 2: { cellWidth: 40 }, 4: { cellWidth: 14, halign: 'center' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const code = String(data.cell.raw).split(' ')[0]
          const pr = plan.projects.find((p) => p.code === code)
          if (pr) data.cell.styles.textColor = hexToRgb(pr.color)
        }
      },
    })
  }
  return { blob: doc.output('blob'), font }
}
