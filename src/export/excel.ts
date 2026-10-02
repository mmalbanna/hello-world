import ExcelJS from 'exceljs'
import { format } from 'date-fns'
import type { PlanData } from './plan'
import { AUTHOR, FONT } from './plan'
import { fmtDay, fmtDayNum, fmtMonth, fmtShort, isWorkingDay } from '../lib/dates'
import { tintHex } from '../lib/colors'
import { PERSON_TYPE_LABEL, TASK_STATUS_LABEL, PRIORITY_LABEL } from '../lib/types'

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`
const base = { name: FONT, size: 10 }
const thin: Partial<ExcelJS.Borders> = { top: { style: 'thin', color: { argb: 'FFD0D5DD' } }, left: { style: 'thin', color: { argb: 'FFD0D5DD' } }, bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } }, right: { style: 'thin', color: { argb: 'FFD0D5DD' } } }

export async function exportExcel(plan: PlanData): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = AUTHOR
  wb.lastModifiedBy = AUTHOR
  wb.created = plan.generatedAt
  wb.modified = plan.generatedAt
  wb.title = plan.title

  /* ---------------------------- Sheet 1: Plan ---------------------------- */
  const ws = wb.addWorksheet('Plan', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } })
  const fixedCols = ['Person', 'Title', 'Discipline', 'Team lead']
  const lastCol = fixedCols.length + plan.days.length

  ws.mergeCells(1, 1, 1, lastCol)
  ws.getCell(1, 1).value = plan.title
  ws.getCell(1, 1).font = { ...base, size: 16, bold: true, color: { argb: 'FF0F4C81' } }
  ws.mergeCells(2, 1, 2, lastCol)
  ws.getCell(2, 1).value = `${plan.orgName} · ${plan.periodLabel}`
  ws.getCell(2, 1).font = { ...base, size: 11 }
  ws.mergeCells(3, 1, 3, lastCol)
  ws.getCell(3, 1).value = `Prepared by ${AUTHOR} · generated ${format(plan.generatedAt, 'd MMM yyyy HH:mm')} by ${plan.generatedBy}`
  ws.getCell(3, 1).font = { ...base, size: 9, color: { argb: 'FF64748B' } }

  // header rows 4 (month/week) and 5 (day)
  fixedCols.forEach((h, i) => {
    ws.mergeCells(4, i + 1, 5, i + 1)
    const c = ws.getCell(4, i + 1)
    c.value = h
    c.font = { ...base, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }
    c.alignment = { vertical: 'middle' }
    c.border = thin
  })
  plan.days.forEach((d, i) => {
    const col = fixedCols.length + i + 1
    const working = isWorkingDay(d, plan.settings)
    const top = ws.getCell(4, col)
    top.value = i === 0 || fmtDayNum(d) === '1' ? fmtMonth(d) : ''
    top.font = { ...base, size: 9, color: { argb: 'FFFFFFFF' } }
    top.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }
    top.alignment = { horizontal: 'center' }
    const c = ws.getCell(5, col)
    c.value = `${fmtDay(d)} ${fmtDayNum(d)}`
    c.font = { ...base, bold: true, color: { argb: working ? 'FFFFFFFF' : 'FFCBD5E1' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: working ? 'FF0F4C81' : 'FF475569' } }
    c.alignment = { horizontal: 'center' }
    c.border = thin
    ws.getColumn(col).width = 16
  })
  ws.getColumn(1).width = 22; ws.getColumn(2).width = 18; ws.getColumn(3).width = 14; ws.getColumn(4).width = 14

  let row = 6
  const leadName = (id: string | null) => plan.people.find((p) => p.id === id)?.name ?? (id ? '' : '')
  for (const g of plan.groups) {
    if (g.label) {
      ws.mergeCells(row, 1, row, lastCol)
      const c = ws.getCell(row, 1)
      c.value = g.label.toUpperCase()
      c.font = { ...base, bold: true, size: 9, color: { argb: 'FF475569' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
      row++
    }
    for (const p of g.people) {
      const fixed = [p.name, p.title, p.discipline, leadName(p.leadId)]
      fixed.forEach((v, i) => {
        const c = ws.getCell(row, i + 1)
        c.value = v
        c.font = { ...base, bold: i === 0 }
        c.border = thin
        c.alignment = { vertical: 'top' }
      })
      plan.days.forEach((d, i) => {
        const c = ws.getCell(row, fixedCols.length + i + 1)
        const working = isWorkingDay(d, plan.settings)
        c.border = thin
        c.alignment = { wrapText: true, vertical: 'top' }
        const cell = plan.cell(p.id, d)
        if (cell) {
          const color = cell.project?.color ?? '#64748b'
          c.value = { richText: [{ text: `${cell.project?.code ?? ''}\n`, font: { ...base, bold: true, color: { argb: argb(color) } } }, { text: cell.task?.name ?? '', font: { ...base, size: 9 } }] }
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tintHex(color, 0.85)) } }
          if (cell.alloc.note) c.note = cell.alloc.note
        } else if (!working) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        }
      })
      ws.getRow(row).height = 30
      row++
    }
  }
  // totals
  row++
  ws.getCell(row, 1).value = 'People per project'
  ws.getCell(row, 1).font = { ...base, bold: true }
  row++
  for (const pr of plan.projects) {
    const t = plan.totals.get(pr.id)
    if (!t || !t.some(Boolean)) continue
    ws.getCell(row, 1).value = `${pr.code} ${pr.name}`
    ws.getCell(row, 1).font = { ...base, bold: true, color: { argb: argb(pr.color) } }
    t.forEach((n, i) => {
      const c = ws.getCell(row, fixedCols.length + i + 1)
      c.value = n || null
      c.font = base
      c.alignment = { horizontal: 'center' }
      c.border = thin
    })
    row++
  }

  /* ------------------------- Sheet 2: By project ------------------------- */
  const bp = wb.addWorksheet('By project', { views: [{ state: 'frozen', ySplit: 1 }] })
  bp.columns = [
    { header: 'Project', key: 'project', width: 28 }, { header: 'Task', key: 'task', width: 40 }, { header: 'Person', key: 'person', width: 22 },
    { header: 'Discipline', key: 'disc', width: 14 }, { header: 'From', key: 'from', width: 12 }, { header: 'To', key: 'to', width: 12 }, { header: 'Days', key: 'days', width: 8 },
  ]
  styleHeader(bp.getRow(1))
  for (const e of plan.byProject) for (const t of e.tasks) for (const pp of t.people) for (const r of pp.runs) {
    const rr = bp.addRow({ project: `${e.project.code} ${e.project.name}`, task: t.task.name, person: pp.person.name, disc: pp.person.discipline, from: fmtShort(r[0]), to: fmtShort(r[r.length - 1]), days: r.length })
    rr.font = base
    rr.getCell(1).font = { ...base, bold: true, color: { argb: argb(e.project.color) } }
  }

  /* --------------------------- Sheet 3: Summary -------------------------- */
  const sm = wb.addWorksheet('Summary')
  sm.getCell(1, 1).value = 'Project'
  plan.days.forEach((d, i) => { sm.getCell(1, i + 2).value = fmtShort(d); sm.getColumn(i + 2).width = 9 })
  sm.getCell(1, plan.days.length + 2).value = 'Person-days'
  styleHeader(sm.getRow(1))
  sm.getColumn(1).width = 30
  let r2 = 2
  for (const pr of plan.projects) {
    const t = plan.totals.get(pr.id)
    if (!t) continue
    sm.getCell(r2, 1).value = `${pr.code} ${pr.name}`
    sm.getCell(r2, 1).font = { ...base, bold: true, color: { argb: argb(pr.color) } }
    t.forEach((n, i) => { const c = sm.getCell(r2, i + 2); c.value = n; c.font = base; c.alignment = { horizontal: 'center' } })
    const tot = sm.getCell(r2, plan.days.length + 2); tot.value = t.reduce((a, b) => a + b, 0); tot.font = { ...base, bold: true }
    r2++
  }
  sm.getCell(r2, 1).value = 'Unallocated people'
  sm.getCell(r2, 1).font = { ...base, bold: true, color: { argb: 'FFB91C1C' } }
  plan.days.forEach((d, i) => {
    const working = isWorkingDay(d, plan.settings)
    const n = working ? plan.people.filter((p) => !plan.cell(p.id, d)).length : 0
    const c = sm.getCell(r2, i + 2); c.value = working ? n : '-'; c.font = base; c.alignment = { horizontal: 'center' }
  })

  /* ---------------------------- Sheet 4: Tasks --------------------------- */
  const ts = wb.addWorksheet('Tasks', { views: [{ state: 'frozen', ySplit: 1 }] })
  ts.columns = [
    { header: 'Project', key: 'project', width: 26 }, { header: 'Task', key: 'task', width: 44 }, { header: 'Discipline', key: 'disc', width: 14 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Priority', key: 'prio', width: 10 }, { header: 'Start', key: 'start', width: 12 }, { header: 'End', key: 'end', width: 12 }, { header: 'Notes', key: 'notes', width: 40 },
  ]
  styleHeader(ts.getRow(1))
  for (const t of plan.tasks) {
    const pr = plan.projects.find((p) => p.id === t.projectId)
    const rr = ts.addRow({ project: pr ? `${pr.code} ${pr.name}` : '', task: t.name, disc: t.discipline, status: TASK_STATUS_LABEL[t.status], prio: PRIORITY_LABEL[t.priority], start: t.startDate ?? '', end: t.endDate ?? '', notes: t.notes })
    rr.font = base
  }

  /* ---------------------------- Sheet 5: People -------------------------- */
  const pe = wb.addWorksheet('People', { views: [{ state: 'frozen', ySplit: 1 }] })
  pe.columns = [{ header: 'Name', key: 'name', width: 24 }, { header: 'Title', key: 'title', width: 20 }, { header: 'Discipline', key: 'disc', width: 14 }, { header: 'Type', key: 'type', width: 16 }, { header: 'Team lead', key: 'lead', width: 18 }, { header: 'Active', key: 'active', width: 8 }]
  styleHeader(pe.getRow(1))
  for (const p of plan.people) pe.addRow({ name: p.name, title: p.title, disc: p.discipline, type: PERSON_TYPE_LABEL[p.type], lead: leadName(p.leadId), active: p.active ? 'Yes' : 'No' }).font = base

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }
    c.border = thin
  })
}
