import { useCallback, useMemo, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Info, X, Search } from 'lucide-react'
import { useStore } from '../store/useStore'
import { allocationId, type Person, type Task } from '../lib/types'
import { fmtLong, fmtShort, isWorkingDay, shiftKey, todayKey } from '../lib/dates'
import { HEALTH, disciplineColor, nextWorkingDay, taskStatusView, type Health } from '../lib/progress'
import { TaskCard, type CardPerson } from '../components/board/TaskCard'
import { Bench } from '../components/board/Bench'
import { QuickAdd } from '../components/board/QuickAdd'
import { MoveSheet, type MoveRequest } from '../components/board/MoveSheet'
import { TaskPanel } from '../components/board/TaskPanel'
import { PersonPopover } from '../components/board/PersonPopover'
import { Avatar } from '../components/Avatar'
import { Button, Select, Spinner, Empty } from '../components/ui'
import { Link } from 'react-router-dom'

const STATUS_ORDER: Record<Task['status'], number> = { in_progress: 0, on_hold: 1, open: 2, done: 3 }

export default function Board() {
  const { people, projects, tasks, allocations, loans, settings, loaded } = useStore()
  const canEdit = useStore((s) => s.canEdit)()
  const setAllocRange = useStore((s) => s.setAllocRange)
  const [date, setDate] = useState(() => nextWorkingDay(todayKey(), settings))
  const [projectFilter, setProjectFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [legend, setLegend] = useState(false)
  const [move, setMove] = useState<MoveRequest | null>(null)
  const [taskPanel, setTaskPanel] = useState<string | null>(null)
  const [personPanel, setPersonPanel] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Person | null>(null)

  const active = useMemo(() => people.filter((p) => p.active), [people])
  const allocToday = useMemo(() => Object.fromEntries(active.map((p) => [p.id, allocations[allocationId(p.id, date)]])), [active, allocations, date])
  const loanById = useMemo(() => Object.fromEntries(loans.map((l) => [l.id, l])), [loans])
  const term = search.trim().toLowerCase()

  const lanes = useMemo(() => projects
    .filter((p) => p.status !== 'closed' && (!projectFilter || p.id === projectFilter))
    .map((project) => {
      const list = tasks
        .filter((t) => t.projectId === project.id && (showDone || t.status !== 'done') && (!term || t.name.toLowerCase().includes(term)))
        .map((t) => ({ task: t, view: taskStatusView(t, date, settings, allocations) }))
        .sort((a, b) => STATUS_ORDER[a.task.status] - STATUS_ORDER[b.task.status] || (a.task.endDate ?? '9999').localeCompare(b.task.endDate ?? '9999') || a.task.order - b.task.order)
      return { project, tasks: list }
    }), [projects, tasks, projectFilter, showDone, term, date, settings, allocations])

  const cardPeople = useCallback((taskId: string): CardPerson[] => active
    .filter((p) => allocToday[p.id]?.taskId === taskId && (!term || true))
    .map((p) => { const a = allocToday[p.id]; const loan = a?.loanId ? loanById[a.loanId] : undefined; return { person: p, ring: disciplineColor(p.discipline, settings), loanReturn: loan ? fmtShort(loan.plannedReturn) : null } }), [active, allocToday, loanById, settings, term])

  const bench = useMemo(() => {
    const free = active.filter((p) => !allocToday[p.id] && (!term || p.name.toLowerCase().includes(term)))
    const groups = new Map<string, Person[]>()
    for (const p of free) (groups.get(p.discipline || 'Other') ?? groups.set(p.discipline || 'Other', []).get(p.discipline || 'Other')!).push(p)
    return [...groups.entries()].sort((a, b) => settings.disciplines.indexOf(a[0]) - settings.disciplines.indexOf(b[0])).map(([label, ps]) => ({ label, color: disciplineColor(label, settings), people: ps }))
  }, [active, allocToday, term, settings])

  const stats = useMemo(() => {
    const onTask = active.filter((p) => allocToday[p.id]).length
    const onLoan = active.filter((p) => allocToday[p.id]?.loanId).length
    const views = lanes.flatMap((l) => l.tasks.map((t) => t.view))
    const count = (h: Health) => views.filter((v) => v.health === h).length
    return { onTask, free: active.length - onTask, onLoan, inProgress: lanes.flatMap((l) => l.tasks).filter((t) => t.task.status === 'in_progress').length, atRisk: count('at_risk'), delayed: count('delayed'), onHold: count('on_hold') }
  }, [active, allocToday, lanes])

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }))
  const onDragStart = (e: DragStartEvent) => { const d = e.active.data.current as { personId: string }; setDragging(people.find((p) => p.id === d.personId) ?? null) }
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const d = e.active.data.current as { personId: string; fromTaskId: string | null } | undefined
    const over = e.over?.data.current as { taskId?: string; bench?: boolean } | undefined
    if (!d || !over) return
    if (over.taskId) { if (over.taskId === d.fromTaskId) return; setMove({ personId: d.personId, fromTaskId: d.fromTaskId, toTaskId: over.taskId, date }) }
    else if (over.bench && d.fromTaskId) setMove({ personId: d.personId, fromTaskId: d.fromTaskId, toTaskId: null, date })
  }
  const go = (dir: -1 | 1) => { let d = shiftKey(date, dir); for (let i = 0; i < 10 && !isWorkingDay(d, settings); i++) d = shiftKey(d, dir); setDate(d); setAllocRange(shiftKey(d, -56), shiftKey(d, 70)) }

  if (!loaded.people || !loaded.projects || !loaded.tasks || !loaded.settings) return <Spinner label="Setting up the table" />
  if (!projects.length || !people.length) return <Empty title="The sand table needs projects and people" text="Add them first, or load the sample data from Settings." action={<Link to="/settings"><Button variant="primary">Open settings</Button></Link>} />

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col md:h-[calc(100vh-2rem)]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-sm">
          <button className="px-2 py-2 hover:bg-slate-50" onClick={() => go(-1)} aria-label="Previous working day"><ChevronLeft className="h-5 w-5" /></button>
          <button className="border-x border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50" onClick={() => setDate(nextWorkingDay(todayKey(), settings))}>Today</button>
          <button className="px-2 py-2 hover:bg-slate-50" onClick={() => go(1)} aria-label="Next working day"><ChevronRight className="h-5 w-5" /></button>
        </div>
        <div className="text-sm font-semibold text-slate-800">{fmtLong(date)}{date === todayKey() ? '' : <span className="ml-1 text-xs font-normal text-amber-700">(not today)</span>}</div>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <Select compact value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}><option value="">All projects</option>{projects.filter((p) => p.status !== 'closed').map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select>
        <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find person or task" className="w-40 rounded-lg border border-slate-300 py-2 pl-8 pr-2 text-sm" /></div>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Done</label>
        <Button variant="ghost" onClick={() => setLegend((v) => !v)}><Info className="h-4 w-4" /> Legend</Button>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span><b className="text-slate-900">{stats.onTask}</b> on tasks</span>
        <span><b className={stats.free ? 'text-emerald-700' : 'text-slate-900'}>{stats.free}</b> available</span>
        <span><b className="text-amber-700">{stats.onLoan}</b> on loan</span>
        <span><b className="text-slate-900">{stats.inProgress}</b> tasks in progress</span>
        {stats.atRisk > 0 && <span><b className="text-amber-700">{stats.atRisk}</b> at risk</span>}
        {stats.delayed > 0 && <span><b className="text-red-700">{stats.delayed}</b> delayed</span>}
        {stats.onHold > 0 && <span><b className="text-violet-700">{stats.onHold}</b> interrupted</span>}
      </div>

      {legend && (
        <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
          <button className="ml-auto order-last" onClick={() => setLegend(false)} aria-label="Close"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-2"><span className="font-semibold text-slate-700">Projects</span>{projects.filter((p) => p.status !== 'closed').map((p) => <span key={p.id} className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: p.color }} />{p.code}</span>)}</div>
          <div className="flex items-center gap-2"><span className="font-semibold text-slate-700">Health</span>{(Object.keys(HEALTH) as Health[]).map((h) => <span key={h} className="rounded px-1 font-medium" style={{ background: HEALTH[h].bg, color: HEALTH[h].text }}>{HEALTH[h].label}</span>)}</div>
          <div className="flex items-center gap-2"><span className="font-semibold text-slate-700">Ring = discipline</span>{settings.disciplines.map((d) => <span key={d} className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full border-2" style={{ borderColor: disciplineColor(d, settings) }} />{d}</span>)}</div>
          <div className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-dashed border-amber-500" /> On loan (returns later)</div>
          <div className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-dashed border-slate-300" /> Person still needed</div>
          <div className="flex items-center gap-2"><span className="inline-block h-3 w-0.5 bg-slate-800" /> Planned % marker on the progress bar</div>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="mb-2 md:hidden"><Bench groups={bench} canEdit={canEdit} onOpenPerson={(p) => setPersonPanel(p.id)} horizontal /></div>
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="hidden w-52 shrink-0 md:block"><Bench groups={bench} canEdit={canEdit} onOpenPerson={(p) => setPersonPanel(p.id)} /></div>
          <div className="grid-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-2">
            {lanes.map(({ project, tasks: list }) => (
              <div key={project.id} className="flex w-[272px] shrink-0 flex-col rounded-xl bg-slate-100/70">
                <div className="flex items-center justify-between rounded-t-xl px-3 py-2 text-white" style={{ background: project.color }}>
                  <div className="min-w-0"><div className="text-sm font-bold leading-tight">{project.code}</div><div className="truncate text-[11px] opacity-90">{project.name}</div></div>
                  <div className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold" title="People on this project today">{active.filter((p) => allocToday[p.id]?.projectId === project.id).length}</div>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {project.status === 'upcoming' && <div className="rounded-lg bg-white/70 px-2 py-1 text-[11px] text-slate-500">Upcoming project (pipeline)</div>}
                  {list.map(({ task, view }) => (
                    <TaskCard key={task.id} task={task} project={project} view={view} people={cardPeople(task.id)} date={date} canEdit={canEdit} onOpen={() => setTaskPanel(task.id)} onOpenPerson={(p) => setPersonPanel(p.id)} />
                  ))}
                  {!list.length && <div className="rounded-lg border border-dashed border-slate-300 px-2 py-3 text-center text-[11px] text-slate-400">No tasks</div>}
                  {canEdit && <QuickAdd projectId={project.id} color={project.color} />}
                </div>
              </div>
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <Avatar person={dragging} size={44} ring={disciplineColor(dragging.discipline, settings)} className="shadow-xl ring-4 ring-white" />}</DragOverlay>
      </DndContext>

      <MoveSheet req={move} onClose={() => setMove(null)} />
      <TaskPanel taskId={taskPanel} date={date} onClose={() => setTaskPanel(null)} onOpenPerson={(p) => { setTaskPanel(null); setPersonPanel(p.id) }} />
      <PersonPopover personId={personPanel} date={date} onClose={() => setPersonPanel(null)} onMove={setMove} onOpenTask={(id) => { setPersonPanel(null); setTaskPanel(id) }} />
    </div>
  )
}
