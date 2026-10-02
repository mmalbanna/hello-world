import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx'
import { format } from 'date-fns'
import type { PlanData } from './plan'
import { AUTHOR, FONT } from './plan'
import { fmtDay, fmtDayNum, fmtShort, isWorkingDay } from '../lib/dates'
import { tintHex } from '../lib/colors'

const hex = (c: string) => c.replace('#', '').toUpperCase()
const border = { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' }
const borders = { top: border, bottom: border, left: border, right: border }
const USABLE = 15398 // A4 landscape width in DXA minus 0.5" margins

function text(t: string, o: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({ text: t, bold: o.bold, size: o.size ?? 18, color: o.color, font: FONT })
}
function para(t: string | TextRun[], o: { bold?: boolean; size?: number; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}) {
  return new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 60 }, children: typeof t === 'string' ? [text(t, o)] : t })
}
function cell(children: Paragraph[], o: { width: number; fill?: string; vAlign?: boolean } = { width: 1000 }) {
  return new TableCell({
    children,
    width: { size: o.width, type: WidthType.DXA },
    borders,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    verticalAlign: o.vAlign ? VerticalAlign.CENTER : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
  })
}

export async function exportWord(plan: PlanData): Promise<Blob> {
  const children: (Paragraph | Table)[] = []
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: plan.title, font: FONT, size: 40, bold: true, color: '0F4C81' })] }))
  children.push(para(`${plan.orgName} · ${plan.periodLabel}`, { size: 22 }))
  children.push(para(`Prepared by ${AUTHOR} · generated ${format(plan.generatedAt, 'd MMMM yyyy HH:mm')} by ${plan.generatedBy}`, { size: 16, color: '64748B', after: 200 }))

  // legend
  const legendRuns: TextRun[] = []
  for (const p of plan.projects.filter((x) => x.status !== 'closed')) {
    legendRuns.push(new TextRun({ text: ` ${p.code} `, font: FONT, size: 16, bold: true, color: 'FFFFFF', shading: { type: ShadingType.CLEAR, fill: hex(p.color), color: 'auto' } }))
    legendRuns.push(text(` ${p.name}    `, { size: 16 }))
  }
  if (legendRuns.length) children.push(new Paragraph({ children: legendRuns, spacing: { after: 200 } }))

  // one table per week
  for (const week of plan.weeks) {
    const nameW = 2400
    const dayW = Math.floor((USABLE - nameW) / week.length)
    children.push(para(`Week of ${fmtShort(week[0])}`, { bold: true, size: 22, after: 80 }))
    const header = new TableRow({
      tableHeader: true,
      children: [
        cell([para('Person', { bold: true, color: 'FFFFFF' })], { width: nameW, fill: '0F4C81', vAlign: true }),
        ...week.map((d) => {
          const working = isWorkingDay(d, plan.settings)
          return cell([para(`${fmtDay(d)} ${fmtDayNum(d)}`, { bold: true, color: working ? 'FFFFFF' : 'CBD5E1', align: AlignmentType.CENTER })], { width: dayW, fill: working ? '0F4C81' : '475569', vAlign: true })
        }),
      ],
    })
    const rows: TableRow[] = [header]
    for (const g of plan.groups) {
      if (g.label) {
        rows.push(new TableRow({ children: [new TableCell({ children: [para(g.label.toUpperCase(), { bold: true, size: 14, color: '475569' })], columnSpan: week.length + 1, borders, shading: { type: ShadingType.CLEAR, fill: 'E2E8F0', color: 'auto' }, margins: { top: 30, bottom: 30, left: 60, right: 60 } })] }))
      }
      for (const p of g.people) {
        rows.push(new TableRow({
          cantSplit: true,
          children: [
            cell([para(p.name, { bold: true }), para(`${p.title}${p.discipline ? ' · ' + p.discipline : ''}`, { size: 14, color: '64748B' })], { width: nameW }),
            ...week.map((d) => {
              const c = plan.cell(p.id, d)
              const working = isWorkingDay(d, plan.settings)
              if (!c) return cell([para('')], { width: dayW, fill: working ? undefined : 'F1F5F9' })
              const color = c.project?.color ?? '#64748b'
              return cell([
                para(c.project?.code ?? '', { bold: true, size: 16, color: hex(color) }),
                para(c.task?.name ?? '', { size: 15 }),
                ...(c.alloc.note ? [para(c.alloc.note, { size: 13, color: '64748B' })] : []),
              ], { width: dayW, fill: tintHex(color, 0.85) })
            }),
          ],
        }))
      }
    }
    children.push(new Table({ rows, width: { size: USABLE, type: WidthType.DXA }, columnWidths: [nameW, ...week.map(() => dayW)] }))
    children.push(para('', { after: 200 }))
  }

  // people per project
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'People per project per day', font: FONT, size: 26, bold: true, color: '0F4C81' })], spacing: { before: 200, after: 100 } }))
  for (const week of plan.weeks) {
    const nameW = 3200
    const dayW = Math.floor((USABLE - nameW) / week.length)
    const rows: TableRow[] = [new TableRow({ tableHeader: true, children: [cell([para('Project', { bold: true, color: 'FFFFFF' })], { width: nameW, fill: '0F4C81' }), ...week.map((d) => cell([para(`${fmtDay(d)} ${fmtDayNum(d)}`, { bold: true, color: 'FFFFFF', align: AlignmentType.CENTER })], { width: dayW, fill: '0F4C81' }))] })]
    for (const pr of plan.projects) {
      const t = plan.totals.get(pr.id)
      if (!t || !t.some(Boolean)) continue
      rows.push(new TableRow({ children: [cell([para(`${pr.code} ${pr.name}`, { bold: true, color: hex(pr.color) })], { width: nameW }), ...week.map((d) => { const n = t[plan.days.indexOf(d)]; return cell([para(n ? String(n) : '', { align: AlignmentType.CENTER, bold: true })], { width: dayW }) })] }))
    }
    children.push(new Table({ rows, width: { size: USABLE, type: WidthType.DXA }, columnWidths: [nameW, ...week.map(() => dayW)] }))
    children.push(para('', { after: 120 }))
  }

  // by project
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Allocation by project', font: FONT, size: 26, bold: true, color: '0F4C81' })], spacing: { before: 200, after: 100 } }))
  for (const e of plan.byProject) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${e.project.code} · ${e.project.name}`, font: FONT, size: 22, bold: true, color: hex(e.project.color) })], spacing: { before: 120, after: 60 } }))
    for (const t of e.tasks) {
      children.push(para(t.task.name, { bold: true, size: 18 }))
      for (const pp of t.people) {
        const runs = pp.runs.map((r) => (r.length === 1 ? fmtShort(r[0]) : `${fmtShort(r[0])} to ${fmtShort(r[r.length - 1])}`)).join(', ')
        children.push(new Paragraph({ bullet: { level: 0 }, children: [text(`${pp.person.name}`, { bold: true, size: 17 }), text(` · ${runs} (${pp.days} day${pp.days > 1 ? 's' : ''})`, { size: 17 })], spacing: { after: 30 } }))
      }
    }
  }
  if (!plan.byProject.length) children.push(para('No allocations in this period.'))

  const doc = new Document({
    creator: AUTHOR,
    lastModifiedBy: AUTHOR,
    title: plan.title,
    description: `${plan.orgName} resource allocation ${plan.periodLabel}`,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children,
    }],
  })
  return Packer.toBlob(doc)
}
