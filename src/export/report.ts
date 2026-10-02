import { AUTHOR, FONT } from './plan'

export interface ReportTable {
  columns: string[]
  rows: (string | number | null)[][]
  /** optional accent colour per row (hex) used for the first cell */
  rowColors?: (string | null)[]
  /** relative column widths */
  widths?: number[]
}
export interface ReportSection { heading: string; text?: string; table?: ReportTable }
export interface ReportKpi { label: string; value: string | number; color?: string }
export interface ReportDoc {
  title: string
  subtitle: string
  generatedBy: string
  generatedAt: Date
  kpis: ReportKpi[]
  sections: ReportSection[]
}

const BRAND = '0F4C81'

export async function reportToExcel(r: ReportDoc): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const { format } = await import('date-fns')
  const wb = new ExcelJS.Workbook()
  wb.creator = AUTHOR; wb.lastModifiedBy = AUTHOR; wb.created = r.generatedAt; wb.title = r.title
  const base = { name: FONT, size: 10 }
  const thin = { top: { style: 'thin' as const, color: { argb: 'FFD0D5DD' } }, left: { style: 'thin' as const, color: { argb: 'FFD0D5DD' } }, bottom: { style: 'thin' as const, color: { argb: 'FFD0D5DD' } }, right: { style: 'thin' as const, color: { argb: 'FFD0D5DD' } } }

  const sum = wb.addWorksheet('Summary')
  sum.getCell(1, 1).value = r.title; sum.getCell(1, 1).font = { ...base, size: 16, bold: true, color: { argb: 'FF' + BRAND } }
  sum.getCell(2, 1).value = r.subtitle; sum.getCell(2, 1).font = { ...base, size: 11 }
  sum.getCell(3, 1).value = `Prepared by ${AUTHOR} · generated ${format(r.generatedAt, 'd MMM yyyy HH:mm')} by ${r.generatedBy}`; sum.getCell(3, 1).font = { ...base, size: 9, color: { argb: 'FF64748B' } }
  let row = 5
  for (const k of r.kpis) {
    sum.getCell(row, 1).value = k.label; sum.getCell(row, 1).font = base
    sum.getCell(row, 2).value = k.value; sum.getCell(row, 2).font = { ...base, bold: true, color: k.color ? { argb: 'FF' + k.color.replace('#', '') } : undefined }
    row++
  }
  row++
  sum.getCell(row, 1).value = 'Sections'; sum.getCell(row, 1).font = { ...base, bold: true }
  for (const sct of r.sections) { row++; sum.getCell(row, 1).value = sct.heading; sum.getCell(row, 1).font = base; sum.getCell(row, 2).value = sct.table ? `${sct.table.rows.length} rows` : ''; sum.getCell(row, 2).font = { ...base, color: { argb: 'FF64748B' } } }
  sum.getColumn(1).width = 44; sum.getColumn(2).width = 24

  const used = new Set<string>(['Summary'])
  for (const sct of r.sections) {
    let name = sct.heading.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28)
    let i = 2
    while (used.has(name)) name = `${name.slice(0, 25)} ${i++}`
    used.add(name)
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: sct.text ? 3 : 1 }] })
    let r0 = 1
    if (sct.text) { ws.getCell(1, 1).value = sct.heading; ws.getCell(1, 1).font = { ...base, bold: true, size: 12 }; ws.getCell(2, 1).value = sct.text; ws.getCell(2, 1).font = { ...base, color: { argb: 'FF475569' } }; r0 = 3 }
    if (!sct.table) continue
    sct.table.columns.forEach((c, ci) => {
      const cell = ws.getCell(r0, ci + 1)
      cell.value = c; cell.font = { ...base, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } }; cell.border = thin
      ws.getColumn(ci + 1).width = Math.max(10, Math.min(60, (sct.table!.widths?.[ci] ?? 1) * 18))
    })
    sct.table.rows.forEach((rw, ri) => {
      rw.forEach((v, ci) => {
        const cell = ws.getCell(r0 + 1 + ri, ci + 1)
        cell.value = v ?? ''
        cell.font = ci === 0 && sct.table!.rowColors?.[ri] ? { ...base, bold: true, color: { argb: 'FF' + sct.table!.rowColors![ri]!.replace('#', '') } } : base
        cell.border = thin
        cell.alignment = { vertical: 'top', wrapText: typeof v === 'string' && v.length > 40 }
      })
    })
    ws.autoFilter = { from: { row: r0, column: 1 }, to: { row: r0, column: sct.table.columns.length } }
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export async function reportToWord(r: ReportDoc): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = await import('docx')
  const { format } = await import('date-fns')
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const USABLE = 15398
  const run = (t: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text: t, bold: o.bold, size: o.size ?? 18, color: o.color, font: FONT })
  const para = (t: string, o: { bold?: boolean; size?: number; color?: string; after?: number } = {}) => new Paragraph({ spacing: { after: o.after ?? 60 }, children: [run(t, o)] })
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: r.title, font: FONT, size: 40, bold: true, color: BRAND })] }))
  children.push(para(r.subtitle, { size: 22 }))
  children.push(para(`Prepared by ${AUTHOR} · generated ${format(r.generatedAt, 'd MMMM yyyy HH:mm')} by ${r.generatedBy}`, { size: 16, color: '64748B', after: 200 }))
  if (r.kpis.length) {
    const perRow = 4
    const rows: InstanceType<typeof TableRow>[] = []
    for (let i = 0; i < r.kpis.length; i += perRow) {
      const slice = r.kpis.slice(i, i + perRow)
      rows.push(new TableRow({ children: slice.map((k) => new TableCell({ width: { size: USABLE / perRow, type: WidthType.DXA }, borders, margins: { top: 80, bottom: 80, left: 100, right: 100 }, shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' }, children: [new Paragraph({ children: [run(String(k.value), { bold: true, size: 32, color: (k.color ?? '#0f4c81').replace('#', '') })] }), new Paragraph({ children: [run(k.label, { size: 16, color: '475569' })] })] })) }))
    }
    children.push(new Table({ rows, width: { size: USABLE, type: WidthType.DXA }, columnWidths: Array(perRow).fill(USABLE / perRow) }))
    children.push(para('', { after: 200 }))
  }
  for (const sct of r.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: sct.heading, font: FONT, size: 26, bold: true, color: BRAND })], spacing: { before: 240, after: 80 } }))
    if (sct.text) children.push(para(sct.text, { size: 17, color: '475569', after: 120 }))
    if (!sct.table) continue
    if (!sct.table.rows.length) { children.push(para('Nothing in this period.', { size: 17, color: '94A3B8' })); continue }
    const weights = sct.table.widths ?? sct.table.columns.map(() => 1)
    const tw = weights.reduce((a, b) => a + b, 0)
    const widths = weights.map((w) => Math.floor((USABLE * w) / tw))
    const header = new TableRow({ tableHeader: true, children: sct.table.columns.map((c, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders, margins: { top: 40, bottom: 40, left: 60, right: 60 }, shading: { type: ShadingType.CLEAR, fill: BRAND, color: 'auto' }, children: [new Paragraph({ children: [run(c, { bold: true, color: 'FFFFFF', size: 16 })] })] })) })
    const rows = sct.table.rows.map((rw, ri) => new TableRow({ cantSplit: true, children: rw.map((v, ci) => new TableCell({ width: { size: widths[ci], type: WidthType.DXA }, borders, margins: { top: 30, bottom: 30, left: 60, right: 60 }, children: [new Paragraph({ alignment: typeof v === 'number' ? AlignmentType.RIGHT : undefined, children: [run(v === null || v === undefined ? '' : String(v), { size: 16, bold: ci === 0 && !!sct.table!.rowColors?.[ri], color: ci === 0 ? sct.table!.rowColors?.[ri]?.replace('#', '') : undefined })] })] })) }))
    children.push(new Table({ rows: [header, ...rows], width: { size: USABLE, type: WidthType.DXA }, columnWidths: widths }))
  }
  const doc = new Document({ creator: AUTHOR, lastModifiedBy: AUTHOR, title: r.title, description: r.subtitle, styles: { default: { document: { run: { font: FONT, size: 18 } } } }, sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }] })
  return Packer.toBlob(doc)
}

export async function reportToPdf(r: ReportDoc): Promise<{ blob: Blob; font: string }> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const { format } = await import('date-fns')
  const { ensurePdfFont } = await import('./pdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const font = await ensurePdfFont(doc)
  doc.setProperties({ title: r.title, author: AUTHOR, creator: AUTHOR, subject: r.subtitle })
  const margin = 10
  doc.setFont(font, 'bold'); doc.setFontSize(16); doc.setTextColor(15, 76, 129); doc.text(r.title, margin, 14)
  doc.setFont(font, 'normal'); doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.text(r.subtitle, margin, 20)
  doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text(`Prepared by ${AUTHOR} · generated ${format(r.generatedAt, 'd MMM yyyy HH:mm')} by ${r.generatedBy}`, margin, 24.5)
  let y = 30
  if (r.kpis.length) {
    const w = (doc.internal.pageSize.getWidth() - margin * 2) / Math.min(6, r.kpis.length)
    r.kpis.slice(0, 12).forEach((k, i) => {
      const col = i % 6; const rowI = Math.floor(i / 6)
      const x = margin + col * w; const yy = y + rowI * 16
      doc.setFillColor(241, 245, 249); doc.roundedRect(x + 1, yy, w - 2, 14, 1.5, 1.5, 'F')
      const [cr, cg, cb] = hex(k.color ?? '#0f4c81')
      doc.setFont(font, 'bold'); doc.setFontSize(13); doc.setTextColor(cr, cg, cb); doc.text(String(k.value), x + 4, yy + 7)
      doc.setFont(font, 'normal'); doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.text(k.label, x + 4, yy + 11.5)
    })
    y += Math.ceil(Math.min(12, r.kpis.length) / 6) * 16 + 4
  }
  for (const sct of r.sections) {
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 12 }
    doc.setFont(font, 'bold'); doc.setFontSize(11); doc.setTextColor(15, 76, 129); doc.text(sct.heading, margin, y + 3)
    y += 6
    if (sct.text) { doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105); const lines = doc.splitTextToSize(sct.text, doc.internal.pageSize.getWidth() - margin * 2); doc.text(lines, margin, y + 2); y += lines.length * 3.6 + 2 }
    if (!sct.table) continue
    if (!sct.table.rows.length) { doc.setFontSize(8); doc.setTextColor(148, 163, 184); doc.text('Nothing in this period.', margin, y + 2); y += 8; continue }
    autoTable(doc, {
      startY: y + 1,
      head: [sct.table.columns],
      body: sct.table.rows.map((rw) => rw.map((v) => (v === null || v === undefined ? '' : String(v)))),
      margin: { left: margin, right: margin },
      styles: { font, fontSize: 7, cellPadding: 1.2, lineColor: [208, 213, 221], lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 76, 129], textColor: 255, fontStyle: 'bold' },
      columnStyles: Object.fromEntries((sct.table.widths ?? []).map((w, i, arr) => [i, { cellWidth: ((doc.internal.pageSize.getWidth() - margin * 2) * w) / arr.reduce((a, b) => a + b, 0) }])),
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) { const c = sct.table!.rowColors?.[d.row.index]; if (c) { d.cell.styles.textColor = hex(c); d.cell.styles.fontStyle = 'bold' } } },
      didDrawPage: () => { doc.setFont(font, 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.text(`${r.title} · page ${doc.getNumberOfPages()}`, margin, doc.internal.pageSize.getHeight() - 5) },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }
  return { blob: doc.output('blob'), font }
}

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
