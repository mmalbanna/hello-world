import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Filter, ListPlus, Copy, MoveRight, FileOutput, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { assign, changeTask, moveAllocation } from '../lib/repo'
import { allocationId, PERSON_TYPE_LABEL, type Allocation, type PersonType } from '../lib/types'
import { fmtDay, fmtDayNum, fmtMonth, fmtShort, isHoliday, isWorkingDay, rangeKeys, shiftKey, todayKey, weekStartKey } from '../lib/dates'
import { DEFAULT_FILTERS, filterPeople, groupPeople, projectTotals, utilisation, type Filters } from '../lib/select'
import { Cell } from '../components/planner/Cell'
import { Chip, ChipBody } from '../components/planner/Chip'
import { TaskPalette } from '../components/planner/TaskPalette'
import { AssignDialog, type AssignTarget } from '../components/planner/AssignDialog'
import { DetailDialog } from '../components/planner/DetailDialog'
import { Button, Select, Input, Spinner, Empty } from '../components/ui'

const LS_FILTERS = 'bimplanner.filters'
const LS_RANGE = 'bimplanner.rangeDays'

export default function Planner() {
  const { people, projects, tasks, allocations, settings, loaded, profile, toast } = useStore()
  const canEdit = useStore((s) => s.canEdit)()
  const setAllocRange = useStore((s) => s.setAllocRange)

  const [start, setStart] = useState(() => weekStartKey(todayKey(), settings))
  const [rangeDays, setRangeDays] = useState<number>(() => Number(localStorage.getItem(LS_RANGE)) || settings.defaultRangeDays)
  const [filters, setFilters] = useState<Filters>(() => {
    try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(LS_FILTERS) || '{}') } } catch { return DEFAULT_FILTERS }
  })
  const [showFilters, setShowFilters] = useState(false)
  const [showPalette, setShowPalette] = useState(() => window.innerWidth >= 1100)
  const [dragMode, setDragMode] = useState<'move' | 'copy'>('move')
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null)
  const [detail, setDetail] = useState<Allocation | null>(null)
  const [active, setActive] = useState<{ kind: 'alloc'; alloc: Allocation } | { kind: 'task'; taskId: string } | null>(null)
  const [pickedTask, setPickedTask] = useState<string | null>(null)

  useEffect(() => { localStorage.setItem(LS_FILTERS, JSON.stringify(filters)) }, [filters])
  useEffect(() => { localStorage.setItem(LS_RANGE, String(rangeDays)) }, [rangeDays])
  useEffect(() => { setStart((s) => weekStartKey(s, settings)) }, [settings])

  const days = useMemo(() => rangeKeys(start, shiftKey(start, rangeDays - 1)), [start, rangeDays])
  useEffect(() => { setAllocRange(days[0], days[days.length - 1]) }, [days, setAllocRange])

  const visible = useMemo(() => filterPeople(people, filters, allocations, days), [people, filters, allocations, days])
  const groups = useMemo(() => groupPeople(visible, people, filters, settings), [visible, people, filters, settings])
  const visibleIds = useMemo(() => new Set(visible.map((p) => p.id)), [visible])
  const totals = useMemo(() => projectTotals(projects, days, allocations, visibleIds), [projects, days, allocations, visibleIds])
  const dayCounts = useMemo(() => days.map((d) => visible.filter((p) => allocations[allocationId(p.id, d)]).length), [days, visible, allocations])
  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])
  const taskById = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks])
  const leads = useMemo(() => people.filter((l) => people.some((p) => p.leadId === l.id)), [people])
  const myEmail = profile?.email?.toLowerCase()
  const today = todayKey()

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as typeof active) ?? null)
  const onDragEnd = useCallback(async (e: DragEndEvent) => {
    setActive(null)
    const data = e.active.data.current as { kind: 'alloc'; alloc: Allocation } | { kind: 'task'; taskId: string } | undefined
    const over = e.over?.data.current as { personId: string; date: string } | undefined
    if (!data || !over) return
    const copy = dragMode === 'copy' || (e.activatorEvent as MouseEvent | undefined)?.altKey
    try {
      if (data.kind === 'alloc') {
        const targetId = allocationId(over.personId, over.date)
        if (targetId === data.alloc.id) return
        const occupied = !!allocations[targetId]
        await moveAllocation(data.alloc.id, over.personId, over.date, copy ? 'copy' : occupied ? 'swap' : 'move')
        if (occupied && !copy) toast('Swapped the two allocations', 'success')
      } else {
        const existing = allocations[allocationId(over.personId, over.date)]
        if (existing) await changeTask(existing, data.taskId, 'day')
        else await assign(over.personId, data.taskId, [over.date], '', false)
      }
    } catch (err) { toast((err as Error).message, 'error') }
  }, [dragMode, allocations, toast])

  const onCellTap = (personId: string, date: string) => {
    if (!canEdit) return
    setAssignTarget({ personId, date, taskId: pickedTask ?? undefined })
  }

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const activeFilterCount = [filters.projectId, filters.discipline, filters.leadId, filters.type, filters.search].filter(Boolean).length

  if (!loaded.people || !loaded.projects || !loaded.tasks || !loaded.settings) return <Spinner label="Loading the plan" />

  const gridEmpty = !people.length
  const pickedTaskObj = pickedTask ? taskById[pickedTask] : null

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col md:h-[calc(100vh-2rem)]">
      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-sm">
          <button className="px-2 py-2 hover:bg-slate-50" onClick={() => setStart((s) => shiftKey(s, -7))} aria-label="Previous week"><ChevronLeft className="h-5 w-5" /></button>
          <button className="border-x border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50" onClick={() => setStart(weekStartKey(today, settings))}>Today</button>
          <button className="px-2 py-2 hover:bg-slate-50" onClick={() => setStart((s) => shiftKey(s, 7))} aria-label="Next week"><ChevronRight className="h-5 w-5" /></button>
        </div>
        <div className="text-sm font-semibold text-slate-800">{fmtShort(days[0])} – {fmtShort(days[days.length - 1])}</div>
        <Select compact value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))} className="min-w-[110px]">
          <option value={7}>1 week</option><option value={14}>2 weeks</option><option value={21}>3 weeks</option><option value={28}>4 weeks</option><option value={42}>6 weeks</option>
        </Select>
        <Button onClick={() => setShowFilters((v) => !v)} className={activeFilterCount ? 'border-brand text-brand' : ''}><Filter className="h-4 w-4" /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</Button>
        {canEdit && (
          <>
            <Button onClick={() => setDragMode((m) => (m === 'move' ? 'copy' : 'move'))} title="Toggle what dragging a chip does (hold Alt on desktop for copy)">
              {dragMode === 'move' ? <><MoveRight className="h-4 w-4" /> Drag moves</> : <><Copy className="h-4 w-4" /> Drag copies</>}
            </Button>
            <Button onClick={() => setShowPalette((v) => !v)} className={showPalette ? 'border-brand text-brand' : ''}><ListPlus className="h-4 w-4" /> Tasks</Button>
          </>
        )}
        <Link to="/reports" className="ml-auto"><Button variant="primary"><FileOutput className="h-4 w-4" /> Share plan</Button></Link>
      </div>

      {showFilters && (
        <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-7">
          <Input placeholder="Search name" value={filters.search} onChange={(e) => setF({ search: e.target.value })} />
          <Select value={filters.projectId} onChange={(e) => setF({ projectId: e.target.value })}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select>
          <Select value={filters.discipline} onChange={(e) => setF({ discipline: e.target.value })}><option value="">All disciplines</option>{settings.disciplines.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
          <Select value={filters.leadId} onChange={(e) => setF({ leadId: e.target.value })}><option value="">All team leads</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select value={filters.type} onChange={(e) => setF({ type: e.target.value as '' | PersonType })}><option value="">All types</option>{(Object.keys(PERSON_TYPE_LABEL) as PersonType[]).map((t) => <option key={t} value={t}>{PERSON_TYPE_LABEL[t]}</option>)}</Select>
          <Select value={filters.groupBy} onChange={(e) => setF({ groupBy: e.target.value as Filters['groupBy'] })}><option value="discipline">Group by discipline</option><option value="lead">Group by team lead</option><option value="none">No grouping</option></Select>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={filters.showInactive} onChange={(e) => setF({ showInactive: e.target.checked })} /> Inactive</label>
            <button className="text-xs text-slate-500 underline" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset</button>
          </div>
        </div>
      )}

      {pickedTaskObj && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">
          Tap any cell to assign <b>{projectById[pickedTaskObj.projectId]?.code} · {pickedTaskObj.name}</b>
          <button className="ml-auto" onClick={() => setPickedTask(null)} aria-label="Clear"><X className="h-4 w-4" /></button>
        </div>
      )}

      {gridEmpty ? (
        <Empty title="No people yet" text="Add your team in the People page, or load sample data from Settings." action={<Link to="/people"><Button variant="primary">Add people</Button></Link>} />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="grid-scroll min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-50">
                    <th className="sticky left-0 z-30 min-w-[150px] border-b border-r border-slate-200 bg-slate-50 px-2 py-1 text-left text-xs font-semibold text-slate-500 sm:min-w-[190px]">
                      {visible.length} people
                    </th>
                    {days.map((d, i) => {
                      const working = isWorkingDay(d, settings)
                      const isToday = d === today
                      const showMonth = i === 0 || fmtDayNum(d) === '1'
                      return (
                        <th key={d} className={`min-w-[96px] border-b border-r border-slate-200 px-1 py-1 text-center font-medium ${working ? 'text-slate-700' : 'bg-slate-100 text-slate-400'} ${isToday ? 'bg-amber-100 text-amber-900' : ''}`}>
                          <div className="text-[10px] uppercase leading-tight">{showMonth ? fmtMonth(d) : fmtDay(d)}</div>
                          <div className="text-base leading-tight">{showMonth ? `${fmtDay(d)} ${fmtDayNum(d)}` : fmtDayNum(d)}</div>
                          <div className="text-[10px] leading-tight text-slate-400">{isHoliday(d, settings) ? 'holiday' : dayCounts[i] ? `${dayCounts[i]} on` : ''}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <GroupRows key={g.key} label={g.label} colSpan={days.length + 1}>
                      {g.people.map((p) => {
                        const u = utilisation(p.id, days, allocations, settings)
                        const me = !!myEmail && p.email === myEmail
                        return (
                          <tr key={p.id} className={me ? 'bg-sky-50' : ''}>
                            <th className={`sticky left-0 z-10 border-b border-r border-slate-200 px-2 py-1 text-left font-normal ${me ? 'bg-sky-50' : 'bg-white'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">{p.name}{!p.active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}</div>
                                  <div className="truncate text-[11px] text-slate-500">{p.title}{p.type !== 'employee' ? ` · ${PERSON_TYPE_LABEL[p.type]}` : ''}</div>
                                </div>
                                <div className={`shrink-0 rounded px-1 text-[10px] ${u.used === u.total ? 'bg-emerald-100 text-emerald-800' : u.used === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`} title="Allocated working days in view">{u.used}/{u.total}</div>
                              </div>
                            </th>
                            {days.map((d) => {
                              const a = allocations[allocationId(p.id, d)]
                              return (
                                <Cell key={d} personId={p.id} date={d} working={isWorkingDay(d, settings)} today={d === today} canEdit={canEdit} empty={!a} onAdd={() => onCellTap(p.id, d)}>
                                  {a && <Chip alloc={a} project={projectById[a.projectId]} task={taskById[a.taskId]} canDrag={canEdit} onOpen={() => (pickedTask && canEdit ? changeTask(a, pickedTask, 'day').catch((e) => toast(e.message, 'error')) : setDetail(a))} />}
                                </Cell>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </GroupRows>
                  ))}
                  {/* project totals */}
                  <tr><td colSpan={days.length + 1} className="sticky left-0 border-b border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">People per project</td></tr>
                  {projects.filter((p) => p.status !== 'closed').map((p) => (
                    <tr key={p.id}>
                      <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-2 py-1 text-left text-xs font-medium">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: p.color }} />{p.code} <span className="text-slate-500">{p.name}</span>
                      </th>
                      {totals.get(p.id)?.map((n, i) => (
                        <td key={days[i]} className={`border-b border-r border-slate-200 text-center text-xs ${n ? 'font-semibold' : 'text-slate-300'}`} style={n ? { color: p.color } : undefined}>{n || '·'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canEdit && showPalette && (
              <aside className="fixed inset-x-0 bottom-14 z-30 max-h-[55vh] rounded-t-2xl border border-slate-200 bg-white p-3 shadow-xl md:static md:z-auto md:max-h-none md:w-72 md:shrink-0 md:rounded-xl md:shadow-none">
                <div className="mb-2 flex items-center justify-between md:hidden"><span className="text-sm font-semibold">Tasks</span><button onClick={() => setShowPalette(false)}><X className="h-5 w-5" /></button></div>
                <div className="h-[45vh] md:h-full">
                  <TaskPalette days={days} canDrag={canEdit} onPick={(id) => { setPickedTask((cur) => (cur === id ? null : id)); if (window.innerWidth < 768) setShowPalette(false) }} />
                </div>
              </aside>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {active?.kind === 'alloc' && <div className="w-24"><ChipBody project={projectById[active.alloc.projectId]} task={taskById[active.alloc.taskId]} ghost /></div>}
            {active?.kind === 'task' && taskById[active.taskId] && <div className="w-24"><ChipBody project={projectById[taskById[active.taskId].projectId]} task={taskById[active.taskId]} ghost /></div>}
          </DragOverlay>
        </DndContext>
      )}

      <AssignDialog target={assignTarget} onClose={() => setAssignTarget(null)} />
      <DetailDialog alloc={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

function GroupRows({ label, colSpan, children }: { label: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      {label && (
        <tr><td colSpan={colSpan} className="sticky left-0 border-b border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</td></tr>
      )}
      {children}
    </>
  )
}
