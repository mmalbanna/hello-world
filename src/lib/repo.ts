import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
  deleteDoc,
  updateDoc,
  type WriteBatch,
} from 'firebase/firestore'
import { getDb } from './firebase'
import { useStore } from '../store/useStore'
import {
  allocationId,
  REASONS,
  type ActivityEntry,
  type Allocation,
  type EventKind,
  type Loan,
  type Person,
  type PlanEvent,
  type Project,
  type Role,
  type Settings,
  type Task,
} from './types'
import { consecutiveRuns, fmtShort, isWorkingDay, rangeKeys, shiftKey, todayKey } from './dates'
import { orderBy, limit, getDoc, Timestamp } from 'firebase/firestore'
import { nextProjectColor } from './colors'

const BATCH_LIMIT = 450

function actor() {
  const { user, profile } = useStore.getState()
  return { uid: user?.uid ?? 'unknown', name: profile?.displayName || user?.email || 'Unknown' }
}

function logTo(batch: WriteBatch, type: ActivityEntry['type'], message: string) {
  const db = getDb()
  const a = actor()
  batch.set(doc(collection(db, 'activity')), {
    at: serverTimestamp(),
    byUid: a.uid,
    byName: a.name,
    type,
    message,
  })
}

type EventInput = Partial<Omit<PlanEvent, 'id' | 'at' | 'byUid' | 'byName' | 'kind' | 'date'>> & { kind: EventKind; date: string }

function eventTo(batch: WriteBatch, e: EventInput) {
  const db = getDb()
  const a = actor()
  batch.set(doc(collection(db, 'events')), {
    at: serverTimestamp(),
    date: e.date,
    byUid: a.uid,
    byName: a.name,
    kind: e.kind,
    taskId: e.taskId ?? null,
    projectId: e.projectId ?? null,
    personId: e.personId ?? null,
    fromTaskId: e.fromTaskId ?? null,
    toTaskId: e.toTaskId ?? null,
    progress: e.progress ?? null,
    reason: e.reason ?? null,
    note: e.note ?? '',
    from: e.from ?? null,
    to: e.to ?? null,
  } satisfies Omit<PlanEvent, 'id'>)
}

/** A task that receives its first allocation starts automatically. */
function autoStart(batch: WriteBatch, task: Task, firstDate: string) {
  const db = getDb()
  if (task.status === 'open' || !task.actualStart) {
    const patch: Partial<Task> = {}
    if (task.status === 'open') patch.status = 'in_progress'
    if (!task.actualStart || firstDate < task.actualStart) patch.actualStart = firstDate
    if (Object.keys(patch).length) {
      batch.update(doc(db, 'tasks', task.id), patch)
      if (patch.status) eventTo(batch, { kind: 'task_started', date: firstDate, taskId: task.id, projectId: task.projectId })
    }
  }
}

async function commitChunks(ops: ((b: WriteBatch) => void)[], type: ActivityEntry['type'], message: string) {
  const db = getDb()
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const b = writeBatch(db)
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(b))
    if (i + BATCH_LIMIT >= ops.length) logTo(b, type, message)
    await b.commit()
  }
}

function describe(personId: string, taskId: string) {
  const s = useStore.getState()
  const p = s.personById(personId)?.name ?? 'someone'
  const t = s.taskById(taskId)
  const pr = t ? s.projectById(t.projectId) : undefined
  return { person: p, task: t ? `${pr?.code ?? ''} ${t.name}`.trim() : 'a task' }
}

/* ----------------------------- Allocations ----------------------------- */

export async function assign(personId: string, taskId: string, dates: string[], note = '', skipNonWorking = true, loanId: string | null = null, silent = false) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const a = actor()
  const keys = (skipNonWorking ? dates.filter((d) => isWorkingDay(d, s.settings)) : dates).sort()
  if (!keys.length) return
  const ops: ((b: WriteBatch) => void)[] = keys.map((date) => (b: WriteBatch) =>
    b.set(doc(db, 'allocations', allocationId(personId, date)), {
      personId,
      taskId,
      projectId: task.projectId,
      date,
      note,
      updatedBy: a.uid,
      updatedByName: a.name,
      updatedAt: serverTimestamp(),
      loanId,
    } satisfies Omit<Allocation, 'id'>),
  )
  ops.push((b) => autoStart(b, task, keys[0]))
  if (!silent) ops.push((b) => eventTo(b, { kind: 'assigned', date: keys[0], taskId, projectId: task.projectId, personId, from: keys[0], to: keys[keys.length - 1], note }))
  const d = describe(personId, taskId)
  const when = keys.length === 1 ? fmtShort(keys[0]) : `${fmtShort(keys[0])} to ${fmtShort(keys[keys.length - 1])} (${keys.length} days)`
  await commitChunks(ops, 'assign', `assigned ${d.person} to ${d.task} on ${when}`)
}

export async function unassign(ids: string[]) {
  if (!ids.length) return
  const db = getDb()
  const s = useStore.getState()
  const first = s.allocations[ids[0]]
  const ops: ((b: WriteBatch) => void)[] = ids.map((id) => (b: WriteBatch) => b.delete(doc(db, 'allocations', id)))
  const d = first ? describe(first.personId, first.taskId) : { person: 'someone', task: 'a task' }
  const dates = ids.map((id) => s.allocations[id]?.date).filter(Boolean).sort()
  if (first) ops.push((b) => eventTo(b, { kind: 'released', date: dates[0] ?? first.date, taskId: first.taskId, projectId: first.projectId, personId: first.personId, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }))
  const when = ids.length === 1 && first ? fmtShort(first.date) : `${ids.length} days`
  await commitChunks(ops, 'unassign', `removed ${d.person} from ${d.task} (${when})`)
}

/** Remove this allocation and every following consecutive day on the same task (a "run"). */
export async function unassignRun(alloc: Allocation, direction: 'forward' | 'both' = 'forward') {
  const s = useStore.getState()
  const mine = Object.values(s.allocations).filter((x) => x.personId === alloc.personId && x.taskId === alloc.taskId)
  const runs = consecutiveRuns(mine.map((x) => x.date))
  const run = runs.find((r) => r.includes(alloc.date)) ?? [alloc.date]
  const dates = direction === 'forward' ? run.filter((d) => d >= alloc.date) : run
  await unassign(dates.map((d) => allocationId(alloc.personId, d)))
}

export type MoveMode = 'move' | 'copy' | 'swap'

export async function moveAllocation(fromId: string, toPersonId: string, toDate: string, mode: MoveMode = 'move') {
  const db = getDb()
  const s = useStore.getState()
  const src = s.allocations[fromId]
  if (!src) throw new Error('Source allocation not found')
  const toId = allocationId(toPersonId, toDate)
  if (toId === fromId) return
  const a = actor()
  const target = s.allocations[toId]
  const b = writeBatch(db)
  const payload = (al: Allocation, personId: string, date: string) => ({
    personId,
    taskId: al.taskId,
    projectId: al.projectId,
    date,
    note: al.note ?? '',
    updatedBy: a.uid,
    updatedByName: a.name,
    updatedAt: serverTimestamp(),
    loanId: al.loanId ?? null,
  })
  b.set(doc(db, 'allocations', toId), payload(src, toPersonId, toDate))
  eventTo(b, { kind: 'moved', date: toDate, taskId: src.taskId, projectId: src.projectId, personId: toPersonId, fromTaskId: src.taskId, toTaskId: src.taskId, from: src.date, to: toDate, note: src.personId === toPersonId ? 'day moved' : `from ${s.personById(src.personId)?.name ?? ''}` })
  if (mode !== 'copy') {
    if (mode === 'swap' && target) b.set(doc(db, 'allocations', fromId), payload(target, src.personId, src.date))
    else b.delete(doc(db, 'allocations', fromId))
  }
  const d = describe(src.personId, src.taskId)
  const toName = s.personById(toPersonId)?.name ?? 'someone'
  const verb = mode === 'copy' ? 'copied' : mode === 'swap' && target ? 'swapped' : 'moved'
  const msg = src.personId === toPersonId
    ? `${verb} ${d.person}'s ${d.task} from ${fmtShort(src.date)} to ${fmtShort(toDate)}`
    : `${verb} ${d.task} from ${d.person} to ${toName} (${fmtShort(toDate)})`
  logTo(b, 'move', msg)
  await b.commit()
}

/** Reassign a whole run (consecutive days on the same task) to another person. */
export async function reassignRun(alloc: Allocation, toPersonId: string, scope: 'day' | 'forward' | 'run') {
  const db = getDb()
  const s = useStore.getState()
  const mine = Object.values(s.allocations).filter((x) => x.personId === alloc.personId && x.taskId === alloc.taskId)
  const runs = consecutiveRuns(mine.map((x) => x.date))
  const run = runs.find((r) => r.includes(alloc.date)) ?? [alloc.date]
  const dates = scope === 'day' ? [alloc.date] : scope === 'forward' ? run.filter((d) => d >= alloc.date) : run
  const a = actor()
  const ops: ((b: WriteBatch) => void)[] = dates.flatMap((date) => [
    (b: WriteBatch) => b.set(doc(db, 'allocations', allocationId(toPersonId, date)), {
      personId: toPersonId,
      taskId: alloc.taskId,
      projectId: alloc.projectId,
      date,
      note: alloc.note ?? '',
      updatedBy: a.uid,
      updatedByName: a.name,
      updatedAt: serverTimestamp(),
      loanId: alloc.loanId ?? null,
    }),
    (b: WriteBatch) => b.delete(doc(db, 'allocations', allocationId(alloc.personId, date))),
  ])
  ops.push((b) => eventTo(b, { kind: 'moved', date: dates[0], taskId: alloc.taskId, projectId: alloc.projectId, personId: toPersonId, fromTaskId: alloc.taskId, toTaskId: alloc.taskId, from: dates[0], to: dates[dates.length - 1], note: `took over from ${s.personById(alloc.personId)?.name ?? ''}` }))
  const d = describe(alloc.personId, alloc.taskId)
  const toName = s.personById(toPersonId)?.name ?? 'someone'
  await commitChunks(ops, 'move', `reassigned ${d.task} from ${d.person} to ${toName} (${dates.length} day${dates.length > 1 ? 's' : ''} from ${fmtShort(dates[0])})`)
}

/** Change the task of an allocation (optionally for the whole following run). */
export async function changeTask(alloc: Allocation, newTaskId: string, scope: 'day' | 'forward') {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(newTaskId)
  if (!task) throw new Error('Task not found')
  const mine = Object.values(s.allocations).filter((x) => x.personId === alloc.personId && x.taskId === alloc.taskId)
  const runs = consecutiveRuns(mine.map((x) => x.date))
  const run = runs.find((r) => r.includes(alloc.date)) ?? [alloc.date]
  const dates = scope === 'day' ? [alloc.date] : run.filter((d) => d >= alloc.date)
  const a = actor()
  const ops: ((b: WriteBatch) => void)[] = dates.map((date) => (b: WriteBatch) =>
    b.update(doc(db, 'allocations', allocationId(alloc.personId, date)), {
      taskId: newTaskId,
      projectId: task.projectId,
      loanId: null,
      updatedBy: a.uid,
      updatedByName: a.name,
      updatedAt: serverTimestamp(),
    }),
  )
  ops.push((b) => autoStart(b, task, dates[0]))
  ops.push((b) => eventTo(b, { kind: 'moved', date: dates[0], taskId: newTaskId, projectId: task.projectId, personId: alloc.personId, fromTaskId: alloc.taskId, toTaskId: newTaskId, from: dates[0], to: dates[dates.length - 1] }))
  const from = describe(alloc.personId, alloc.taskId)
  const to = describe(alloc.personId, newTaskId)
  await commitChunks(ops, 'move', `changed ${from.person} from ${from.task} to ${to.task} (${dates.length} day${dates.length > 1 ? 's' : ''} from ${fmtShort(dates[0])})`)
}

export async function setAllocationNote(id: string, note: string) {
  const a = actor()
  await updateDoc(doc(getDb(), 'allocations', id), { note, updatedBy: a.uid, updatedByName: a.name, updatedAt: serverTimestamp() })
}

/** One-off fetch for reports/exports over any date range. */
export async function fetchAllocations(start: string, end: string): Promise<Allocation[]> {
  const db = getDb()
  const snap = await getDocs(query(collection(db, 'allocations'), where('date', '>=', start), where('date', '<=', end)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Allocation, 'id'>) }))
}

/* ------------------------------- Projects ------------------------------- */

export async function upsertProject(p: Partial<Project> & { code: string; name: string }, id?: string) {
  const db = getDb()
  const s = useStore.getState()
  const b = writeBatch(db)
  const ref = id ? doc(db, 'projects', id) : doc(collection(db, 'projects'))
  const existing = id ? s.projectById(id) : undefined
  const data: Omit<Project, 'id'> = {
    code: p.code.trim(),
    name: p.name.trim(),
    client: p.client ?? existing?.client ?? '',
    color: p.color ?? existing?.color ?? nextProjectColor(s.projects.map((x) => x.color)),
    status: p.status ?? existing?.status ?? 'active',
    order: p.order ?? existing?.order ?? s.projects.length,
    notes: p.notes ?? existing?.notes ?? '',
  }
  b.set(ref, data, { merge: true })
  logTo(b, 'project', `${id ? 'updated' : 'added'} project ${data.code} ${data.name}`)
  await b.commit()
  return ref.id
}

export async function deleteProject(id: string) {
  const db = getDb()
  const s = useStore.getState()
  const p = s.projectById(id)
  const tasks = await getDocs(query(collection(db, 'tasks'), where('projectId', '==', id)))
  const allocs = await getDocs(query(collection(db, 'allocations'), where('projectId', '==', id)))
  const ops: ((b: WriteBatch) => void)[] = [
    ...tasks.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
    ...allocs.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
    (b: WriteBatch) => b.delete(doc(db, 'projects', id)),
  ]
  await commitChunks(ops, 'project', `deleted project ${p?.code ?? ''} with ${tasks.size} tasks and ${allocs.size} allocations`)
}

/* -------------------------------- Tasks -------------------------------- */

export async function upsertTask(t: Partial<Task> & { projectId: string; name: string }, id?: string) {
  const db = getDb()
  const s = useStore.getState()
  const b = writeBatch(db)
  const ref = id ? doc(db, 'tasks', id) : doc(collection(db, 'tasks'))
  const existing = id ? s.taskById(id) : undefined
  const data: Omit<Task, 'id'> = {
    projectId: t.projectId,
    name: t.name.trim(),
    discipline: t.discipline ?? existing?.discipline ?? '',
    startDate: t.startDate ?? existing?.startDate ?? null,
    endDate: t.endDate ?? existing?.endDate ?? null,
    status: t.status ?? existing?.status ?? 'open',
    priority: t.priority ?? existing?.priority ?? 'normal',
    order: t.order ?? existing?.order ?? s.tasks.length,
    notes: t.notes ?? existing?.notes ?? '',
    headcount: t.headcount ?? existing?.headcount ?? null,
    plannedDays: t.plannedDays ?? existing?.plannedDays ?? null,
    progress: t.progress ?? existing?.progress ?? 0,
    actualStart: t.actualStart ?? existing?.actualStart ?? null,
    actualEnd: t.actualEnd ?? existing?.actualEnd ?? null,
    deliverable: t.deliverable ?? existing?.deliverable ?? '',
  }
  b.set(ref, data, { merge: true })
  if (!id) eventTo(b, { kind: 'task_created', date: todayKey(), taskId: ref.id, projectId: data.projectId, to: data.endDate })
  else if (existing && existing.endDate !== data.endDate && data.endDate) eventTo(b, { kind: 'task_replanned', date: todayKey(), taskId: ref.id, projectId: data.projectId, from: existing.endDate, to: data.endDate, note: 'edited in task form' })
  // keep denormalised projectId on allocations in sync if the task moved project
  if (existing && existing.projectId !== data.projectId) {
    const allocs = await getDocs(query(collection(db, 'allocations'), where('taskId', '==', ref.id)))
    allocs.docs.forEach((d) => b.update(d.ref, { projectId: data.projectId }))
  }
  const pr = s.projectById(data.projectId)
  logTo(b, 'task', `${id ? 'updated' : 'added'} task ${pr?.code ?? ''} ${data.name}`)
  await b.commit()
  return ref.id
}

export async function deleteTask(id: string) {
  const db = getDb()
  const s = useStore.getState()
  const t = s.taskById(id)
  const allocs = await getDocs(query(collection(db, 'allocations'), where('taskId', '==', id)))
  const ops: ((b: WriteBatch) => void)[] = [
    ...allocs.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
    (b: WriteBatch) => b.delete(doc(db, 'tasks', id)),
  ]
  await commitChunks(ops, 'task', `deleted task ${t?.name ?? ''} and ${allocs.size} allocations`)
}

/* -------------------------------- People -------------------------------- */

export async function upsertPerson(p: Partial<Person> & { name: string }, id?: string) {
  const db = getDb()
  const s = useStore.getState()
  const b = writeBatch(db)
  const ref = id ? doc(db, 'people', id) : doc(collection(db, 'people'))
  const existing = id ? s.personById(id) : undefined
  const data: Omit<Person, 'id'> = {
    name: p.name.trim(),
    title: p.title ?? existing?.title ?? 'BIM Modeler',
    discipline: p.discipline ?? existing?.discipline ?? '',
    type: p.type ?? existing?.type ?? 'employee',
    leadId: p.leadId === undefined ? existing?.leadId ?? null : p.leadId,
    email: (p.email ?? existing?.email ?? '').trim().toLowerCase(),
    active: p.active ?? existing?.active ?? true,
    order: p.order ?? existing?.order ?? s.people.length,
    notes: p.notes ?? existing?.notes ?? '',
    photo: p.photo === undefined ? existing?.photo ?? null : p.photo,
  }
  b.set(ref, data, { merge: true })
  logTo(b, 'person', `${id ? 'updated' : 'added'} ${data.name}`)
  await b.commit()
  return ref.id
}

export async function deletePerson(id: string) {
  const db = getDb()
  const s = useStore.getState()
  const p = s.personById(id)
  const allocs = await getDocs(query(collection(db, 'allocations'), where('personId', '==', id)))
  const ops: ((b: WriteBatch) => void)[] = [
    ...allocs.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
    (b: WriteBatch) => b.delete(doc(db, 'people', id)),
  ]
  // people led by this person lose their lead
  s.people.filter((x) => x.leadId === id).forEach((x) => ops.push((b) => b.update(doc(db, 'people', x.id), { leadId: null })))
  await commitChunks(ops, 'person', `removed ${p?.name ?? ''} and ${allocs.size} allocations`)
}

export async function reorderPeople(ids: string[]) {
  const db = getDb()
  const ops = ids.map((id, i) => (b: WriteBatch) => b.update(doc(db, 'people', id), { order: i }))
  await commitChunks(ops, 'person', 'reordered people')
}

/* ------------------------------- Settings ------------------------------- */

export async function saveSettings(patch: Partial<Settings>) {
  const db = getDb()
  const b = writeBatch(db)
  b.set(doc(db, 'settings', 'general'), patch, { merge: true })
  logTo(b, 'settings', 'updated settings')
  await b.commit()
}

/* --------------------------------- Users -------------------------------- */

export async function setUserRole(uid: string, role: Role) {
  const db = getDb()
  const s = useStore.getState()
  const u = s.users.find((x) => x.uid === uid)
  const b = writeBatch(db)
  b.update(doc(db, 'users', uid), { role })
  logTo(b, 'user', `set ${u?.displayName ?? u?.email ?? uid} as ${role}`)
  await b.commit()
}

export async function updateMyName(uid: string, displayName: string) {
  await updateDoc(doc(getDb(), 'users', uid), { displayName })
}

export async function removeUserProfile(uid: string) {
  await deleteDoc(doc(getDb(), 'users', uid))
}

/* ------------------------------ Sample data ------------------------------ */

export async function seedSampleData() {
  const db = getDb()
  const s = useStore.getState()
  if (s.projects.length || s.people.length) throw new Error('Sample data can only be loaded into an empty workspace.')
  const projects = [
    { code: 'P820', name: 'Qatar Central Bank', client: 'QCB' },
    { code: 'P860', name: 'Qatar Airways Headquarters', client: 'Qatar Airways' },
    { code: 'P875', name: 'Hamad Medical Corporation', client: 'HMC' },
    { code: 'P880', name: 'NKIA', client: 'NKIA' },
  ]
  const leads = [
    { name: 'Raja', discipline: 'Architectural' },
    { name: 'Gloria', discipline: 'MEP' },
    { name: 'Suresh', discipline: 'Structural' },
  ]
  const b = writeBatch(db)
  const projectIds: string[] = []
  projects.forEach((p, i) => {
    const ref = doc(collection(db, 'projects'))
    projectIds.push(ref.id)
    b.set(ref, { ...p, color: nextProjectColor(projectIds.length ? [] : []), status: 'active', order: i, notes: '' })
  })
  // distinct colours
  projectIds.forEach((id, i) => b.update(doc(db, 'projects', id), { color: ['#0f4c81', '#c2410c', '#15803d', '#7c3aed'][i] }))

  const leadIds: string[] = []
  leads.forEach((l, i) => {
    const ref = doc(collection(db, 'people'))
    leadIds.push(ref.id)
    b.set(ref, { name: l.name, title: 'Team Lead', discipline: l.discipline, type: 'employee', leadId: null, email: '', active: true, order: i, notes: '', photo: null })
  })
  const modelers = [
    ['Ahmed', 'Architectural', 0], ['Fatima', 'Architectural', 0], ['Hassan', 'Architectural', 0],
    ['Priya', 'MEP', 1], ['Joseph', 'MEP', 1], ['Maria', 'MEP', 1],
    ['Kumar', 'Structural', 2], ['Ali', 'Structural', 2], ['Noor', 'Structural', 2],
  ] as const
  modelers.forEach(([name, discipline, lead], i) => {
    b.set(doc(collection(db, 'people')), { name, title: 'BIM Modeler', discipline, type: 'employee', leadId: leadIds[lead], email: '', active: true, order: 10 + i, notes: '', photo: null })
  })
  b.set(doc(collection(db, 'people')), { name: 'Steel Fabricator (sub)', title: 'Subcontractor', discipline: 'Structural', type: 'subcontractor', leadId: leadIds[2], email: '', active: true, order: 30, notes: '', photo: null })

  const tasks: [number, string, string][] = [
    [0, 'LOD 400 Architectural model - Tower', 'Architectural'],
    [0, 'Clash resolution - Level 10 to 15', 'Coordination'],
    [1, 'MEP coordination model - Podium', 'MEP'],
    [1, 'Structural steel connections', 'Structural'],
    [2, 'Existing conditions model - Block C', 'Architectural'],
    [2, 'MEP shop drawings - OR suites', 'MEP'],
    [3, 'Federated model QA', 'Coordination'],
    [3, 'Structural rebar modelling', 'Structural'],
  ]
  tasks.forEach(([pi, name, discipline], i) => {
    const start = shiftKey(todayKey(), [-7, 0, 7][i % 3])
    b.set(doc(collection(db, 'tasks')), { projectId: projectIds[pi], name, discipline, startDate: start, endDate: shiftKey(start, 21 + (i % 4) * 7), status: 'open', priority: i % 5 === 0 ? 'high' : 'normal', order: i, notes: '', headcount: null, plannedDays: 20 + i * 5, progress: 0, actualStart: null, actualEnd: null, deliverable: '' })
  })
  b.set(doc(db, 'settings', 'general'), { orgName: 'BIM Team' }, { merge: true })
  logTo(b, 'bulk', 'loaded sample projects, people and tasks')
  await b.commit()
}

/* --------------------------- Sand table moves --------------------------- */

export type MoveMode2 = 'move' | 'lend'

/**
 * Put a person on a task from `from` to `until` (working days only).
 * mode 'lend' records a loan from their current task so they can be returned later.
 */
export async function movePerson(opts: { personId: string; toTaskId: string; from: string; until: string; mode: MoveMode2; fromTaskId?: string | null; reason?: string; note?: string }) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(opts.toTaskId)
  if (!task) throw new Error('Task not found')
  const person = s.personById(opts.personId)
  const fromTask = opts.fromTaskId ? s.taskById(opts.fromTaskId) : undefined
  const dates = rangeKeys(opts.from, opts.until).filter((d) => isWorkingDay(d, s.settings))
  if (!dates.length) throw new Error('No working days in that range')
  const a = actor()
  let loanId: string | null = null
  const ops: ((b: WriteBatch) => void)[] = []
  if (opts.mode === 'lend' && fromTask) {
    const ref = doc(collection(db, 'loans'))
    loanId = ref.id
    ops.push((b) => b.set(ref, {
      personId: opts.personId,
      fromTaskId: fromTask.id,
      fromProjectId: fromTask.projectId,
      toTaskId: task.id,
      toProjectId: task.projectId,
      startDate: dates[0],
      plannedReturn: dates[dates.length - 1],
      actualReturn: null,
      reason: opts.reason ?? 'other',
      note: opts.note ?? '',
      status: 'active',
      createdBy: a.uid,
      createdByName: a.name,
      createdAt: serverTimestamp(),
    } satisfies Omit<Loan, 'id'>))
  }
  const lid = loanId
  dates.forEach((date) => ops.push((b) => b.set(doc(db, 'allocations', allocationId(opts.personId, date)), {
    personId: opts.personId, taskId: task.id, projectId: task.projectId, date, note: opts.note ?? '', updatedBy: a.uid, updatedByName: a.name, updatedAt: serverTimestamp(), loanId: lid,
  } satisfies Omit<Allocation, 'id'>)))
  ops.push((b) => autoStart(b, task, dates[0]))
  ops.push((b) => eventTo(b, {
    kind: opts.mode === 'lend' && fromTask ? 'loan_started' : fromTask ? 'moved' : 'assigned',
    date: dates[0], taskId: task.id, projectId: task.projectId, personId: opts.personId,
    fromTaskId: fromTask?.id ?? null, toTaskId: task.id, from: dates[0], to: dates[dates.length - 1], reason: opts.reason ?? null, note: opts.note ?? '',
  }))
  const d = describe(opts.personId, task.id)
  const verb = opts.mode === 'lend' && fromTask ? `lent ${d.person} to ${d.task} until ${fmtShort(dates[dates.length - 1])} (returns to ${fromTask.name})` : fromTask ? `moved ${d.person} to ${d.task} (${fmtShort(dates[0])} to ${fmtShort(dates[dates.length - 1])})` : `put ${d.person} on ${d.task} (${fmtShort(dates[0])} to ${fmtShort(dates[dates.length - 1])})`
  await commitChunks(ops, 'move', `${verb}${opts.reason ? ' · ' + (REASONS[opts.reason] ?? opts.reason) : ''}`)
  if (person && !person.active) { /* nothing */ }
  return loanId
}

/** Take a person off a task from `from` to `until` (sand table drop on the bench). */
export async function releasePerson(opts: { personId: string; taskId: string; from: string; until: string; reason?: string; note?: string }) {
  const db = getDb()
  const s = useStore.getState()
  const dates = rangeKeys(opts.from, opts.until).filter((d) => s.allocations[allocationId(opts.personId, d)]?.taskId === opts.taskId)
  if (!dates.length) return
  const task = s.taskById(opts.taskId)
  const ops: ((b: WriteBatch) => void)[] = dates.map((d) => (b) => b.delete(doc(db, 'allocations', allocationId(opts.personId, d))))
  ops.push((b) => eventTo(b, { kind: 'released', date: dates[0], taskId: opts.taskId, projectId: task?.projectId ?? null, personId: opts.personId, from: dates[0], to: dates[dates.length - 1], reason: opts.reason ?? null, note: opts.note ?? '' }))
  const d = describe(opts.personId, opts.taskId)
  await commitChunks(ops, 'unassign', `released ${d.person} from ${d.task} (${fmtShort(dates[0])} to ${fmtShort(dates[dates.length - 1])})${opts.reason ? ' · ' + (REASONS[opts.reason] ?? opts.reason) : ''}`)
}

/** Return a lent person to their previous task from `returnDate` onward (early or on time). */
export async function returnLoan(loanId: string, returnDate: string, note = '') {
  const db = getDb()
  const s = useStore.getState()
  const loan = s.loans.find((l) => l.id === loanId)
  if (!loan) throw new Error('Loan not found')
  const a = actor()
  const snap = await getDocs(query(collection(db, 'allocations'), where('loanId', '==', loanId)))
  const toRestore = snap.docs.filter((d) => (d.data() as Allocation).date >= returnDate)
  const ops: ((b: WriteBatch) => void)[] = toRestore.map((d) => (b) => b.update(d.ref, {
    taskId: loan.fromTaskId, projectId: loan.fromProjectId, loanId: null, updatedBy: a.uid, updatedByName: a.name, updatedAt: serverTimestamp(),
  }))
  // days before the return date stay on the borrowed task but are no longer "on loan"
  snap.docs.filter((d) => (d.data() as Allocation).date < returnDate).forEach((d) => ops.push((b) => b.update(d.ref, { loanId: null })))
  ops.push((b) => b.update(doc(db, 'loans', loanId), { status: 'returned', actualReturn: returnDate }))
  ops.push((b) => eventTo(b, { kind: 'loan_returned', date: returnDate, taskId: loan.fromTaskId, projectId: loan.fromProjectId, personId: loan.personId, fromTaskId: loan.toTaskId, toTaskId: loan.fromTaskId, from: loan.startDate, to: returnDate, note }))
  const d = describe(loan.personId, loan.fromTaskId)
  const early = returnDate < loan.plannedReturn ? ' (early)' : returnDate > loan.plannedReturn ? ' (late)' : ''
  await commitChunks(ops, 'move', `returned ${d.person} to ${d.task} from ${fmtShort(returnDate)}${early}`)
}

export async function extendLoan(loanId: string, newReturn: string, note = '') {
  const db = getDb()
  const s = useStore.getState()
  const loan = s.loans.find((l) => l.id === loanId)
  if (!loan) throw new Error('Loan not found')
  if (newReturn <= loan.plannedReturn) throw new Error('Choose a date after the current planned return')
  const extra = rangeKeys(shiftKey(loan.plannedReturn, 1), newReturn).filter((d) => isWorkingDay(d, s.settings))
  const task = s.taskById(loan.toTaskId)
  const a = actor()
  const ops: ((b: WriteBatch) => void)[] = extra.map((date) => (b) => b.set(doc(db, 'allocations', allocationId(loan.personId, date)), {
    personId: loan.personId, taskId: loan.toTaskId, projectId: loan.toProjectId, date, note: '', updatedBy: a.uid, updatedByName: a.name, updatedAt: serverTimestamp(), loanId,
  } satisfies Omit<Allocation, 'id'>))
  ops.push((b) => b.update(doc(db, 'loans', loanId), { plannedReturn: newReturn }))
  ops.push((b) => eventTo(b, { kind: 'loan_extended', date: todayKey(), taskId: loan.toTaskId, projectId: loan.toProjectId, personId: loan.personId, fromTaskId: loan.fromTaskId, toTaskId: loan.toTaskId, from: loan.plannedReturn, to: newReturn, note }))
  const d = describe(loan.personId, loan.toTaskId)
  await commitChunks(ops, 'move', `extended ${d.person}'s loan on ${task?.name ?? d.task} until ${fmtShort(newReturn)}`)
}

/* --------------------------- Progress tracking -------------------------- */

export async function updateProgress(taskId: string, progress: number, note = '', date = todayKey()) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const a = actor()
  const p = Math.max(0, Math.min(100, Math.round(progress)))
  const b = writeBatch(db)
  const patch: Partial<Task> = { progress: p, progressUpdatedAt: serverTimestamp(), progressUpdatedBy: a.name }
  if (p === 100) { patch.status = 'done'; patch.actualEnd = date }
  else if (task.status === 'done') { patch.status = 'in_progress'; patch.actualEnd = null }
  else if (task.status === 'open' && p > 0) { patch.status = 'in_progress'; patch.actualStart = task.actualStart ?? date }
  b.update(doc(db, 'tasks', taskId), patch)
  eventTo(b, { kind: p === 100 ? 'task_completed' : 'progress', date, taskId, projectId: task.projectId, progress: p, note })
  const pr = s.projectById(task.projectId)
  logTo(b, 'task', `${p === 100 ? 'completed' : `updated progress of`} ${pr?.code ?? ''} ${task.name}${p === 100 ? '' : ` to ${p}%`}${note ? ' · ' + note : ''}`)
  await b.commit()
}

export async function interruptTask(taskId: string, reason: string, note = '', date = todayKey()) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const b = writeBatch(db)
  b.update(doc(db, 'tasks', taskId), { status: 'on_hold' })
  eventTo(b, { kind: 'task_interrupted', date, taskId, projectId: task.projectId, reason, note })
  logTo(b, 'task', `interrupted ${s.projectById(task.projectId)?.code ?? ''} ${task.name} · ${REASONS[reason] ?? reason}${note ? ' · ' + note : ''}`)
  await b.commit()
}

export async function resumeTask(taskId: string, note = '', date = todayKey()) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const b = writeBatch(db)
  b.update(doc(db, 'tasks', taskId), { status: 'in_progress', actualStart: task.actualStart ?? date })
  eventTo(b, { kind: 'task_resumed', date, taskId, projectId: task.projectId, note })
  logTo(b, 'task', `resumed ${s.projectById(task.projectId)?.code ?? ''} ${task.name}`)
  await b.commit()
}

export async function reopenTask(taskId: string, note = '', date = todayKey()) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const b = writeBatch(db)
  b.update(doc(db, 'tasks', taskId), { status: 'in_progress', actualEnd: null, progress: Math.min(task.progress, 99) })
  eventTo(b, { kind: 'task_reopened', date, taskId, projectId: task.projectId, note })
  logTo(b, 'task', `reopened ${s.projectById(task.projectId)?.code ?? ''} ${task.name}`)
  await b.commit()
}

export async function replanTask(taskId: string, newEnd: string, reason: string, note = '', date = todayKey()) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const b = writeBatch(db)
  b.update(doc(db, 'tasks', taskId), { endDate: newEnd })
  eventTo(b, { kind: 'task_replanned', date, taskId, projectId: task.projectId, reason, note, from: task.endDate, to: newEnd })
  logTo(b, 'task', `replanned ${s.projectById(task.projectId)?.code ?? ''} ${task.name} to finish ${fmtShort(newEnd)} · ${REASONS[reason] ?? reason}${note ? ' · ' + note : ''}`)
  await b.commit()
}

export async function quickAddTask(projectId: string, name: string, extra: Partial<Task> = {}) {
  return upsertTask({ projectId, name, ...extra })
}

export async function setPersonPhoto(personId: string, photo: string | null) {
  await updateDoc(doc(getDb(), 'people', personId), { photo })
}

/* ------------------------------ Fetch helpers ---------------------------- */

export async function fetchTaskEvents(taskId: string): Promise<PlanEvent[]> {
  const db = getDb()
  const snap = await getDocs(query(collection(db, 'events'), where('taskId', '==', taskId), orderBy('at', 'desc'), limit(200)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlanEvent, 'id'>) }))
}

/** Events recorded between the start of `start` and the end of `end` (local time). */
export async function fetchEvents(start: string, end: string): Promise<PlanEvent[]> {
  const db = getDb()
  const from = new Date(`${start}T00:00:00`)
  const to = new Date(`${end}T23:59:59.999`)
  const snap = await getDocs(query(collection(db, 'events'), where('at', '>=', Timestamp.fromDate(from)), where('at', '<=', Timestamp.fromDate(to)), orderBy('at', 'asc')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlanEvent, 'id'>) }))
}

export async function fetchTaskAllocations(taskId: string): Promise<Allocation[]> {
  const db = getDb()
  const snap = await getDocs(query(collection(db, 'allocations'), where('taskId', '==', taskId)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Allocation, 'id'>) }))
}

export async function fetchAllLoans(): Promise<Loan[]> {
  const db = getDb()
  const snap = await getDocs(query(collection(db, 'loans'), orderBy('createdAt', 'desc'), limit(1000)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Loan, 'id'>) }))
}

export async function fetchTask(taskId: string): Promise<Task | null> {
  const snap = await getDoc(doc(getDb(), 'tasks', taskId))
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Task, 'id'>) }) : null
}

export const helpers = { shiftKey, rangeKeys }
