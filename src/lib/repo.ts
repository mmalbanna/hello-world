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
  type ActivityEntry,
  type Allocation,
  type Person,
  type Project,
  type Role,
  type Settings,
  type Task,
} from './types'
import { consecutiveRuns, fmtShort, isWorkingDay, rangeKeys, shiftKey } from './dates'
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

export async function assign(personId: string, taskId: string, dates: string[], note = '', skipNonWorking = true) {
  const db = getDb()
  const s = useStore.getState()
  const task = s.taskById(taskId)
  if (!task) throw new Error('Task not found')
  const a = actor()
  const keys = skipNonWorking ? dates.filter((d) => isWorkingDay(d, s.settings)) : dates
  if (!keys.length) return
  const ops = keys.map((date) => (b: WriteBatch) =>
    b.set(doc(db, 'allocations', allocationId(personId, date)), {
      personId,
      taskId,
      projectId: task.projectId,
      date,
      note,
      updatedBy: a.uid,
      updatedByName: a.name,
      updatedAt: serverTimestamp(),
    } satisfies Omit<Allocation, 'id'>),
  )
  const d = describe(personId, taskId)
  const when = keys.length === 1 ? fmtShort(keys[0]) : `${fmtShort(keys[0])} to ${fmtShort(keys[keys.length - 1])} (${keys.length} days)`
  await commitChunks(ops, 'assign', `assigned ${d.person} to ${d.task} on ${when}`)
}

export async function unassign(ids: string[]) {
  if (!ids.length) return
  const db = getDb()
  const s = useStore.getState()
  const first = s.allocations[ids[0]]
  const ops = ids.map((id) => (b: WriteBatch) => b.delete(doc(db, 'allocations', id)))
  const d = first ? describe(first.personId, first.taskId) : { person: 'someone', task: 'a task' }
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
  })
  b.set(doc(db, 'allocations', toId), payload(src, toPersonId, toDate))
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
  const ops = dates.flatMap((date) => [
    (b: WriteBatch) => b.set(doc(db, 'allocations', allocationId(toPersonId, date)), {
      personId: toPersonId,
      taskId: alloc.taskId,
      projectId: alloc.projectId,
      date,
      note: alloc.note ?? '',
      updatedBy: a.uid,
      updatedByName: a.name,
      updatedAt: serverTimestamp(),
    }),
    (b: WriteBatch) => b.delete(doc(db, 'allocations', allocationId(alloc.personId, date))),
  ])
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
  const ops = dates.map((date) => (b: WriteBatch) =>
    b.update(doc(db, 'allocations', allocationId(alloc.personId, date)), {
      taskId: newTaskId,
      projectId: task.projectId,
      updatedBy: a.uid,
      updatedByName: a.name,
      updatedAt: serverTimestamp(),
    }),
  )
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
  }
  b.set(ref, data, { merge: true })
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
    b.set(ref, { name: l.name, title: 'Team Lead', discipline: l.discipline, type: 'employee', leadId: null, email: '', active: true, order: i, notes: '' })
  })
  const modelers = [
    ['Ahmed', 'Architectural', 0], ['Fatima', 'Architectural', 0], ['Hassan', 'Architectural', 0],
    ['Priya', 'MEP', 1], ['Joseph', 'MEP', 1], ['Maria', 'MEP', 1],
    ['Kumar', 'Structural', 2], ['Ali', 'Structural', 2], ['Noor', 'Structural', 2],
  ] as const
  modelers.forEach(([name, discipline, lead], i) => {
    b.set(doc(collection(db, 'people')), { name, title: 'BIM Modeler', discipline, type: 'employee', leadId: leadIds[lead], email: '', active: true, order: 10 + i, notes: '' })
  })
  b.set(doc(collection(db, 'people')), { name: 'Steel Fabricator (sub)', title: 'Subcontractor', discipline: 'Structural', type: 'subcontractor', leadId: leadIds[2], email: '', active: true, order: 30, notes: '' })

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
    b.set(doc(collection(db, 'tasks')), { projectId: projectIds[pi], name, discipline, startDate: null, endDate: null, status: 'open', priority: 'normal', order: i, notes: '', headcount: null })
  })
  b.set(doc(db, 'settings', 'general'), { orgName: 'BIM Team' }, { merge: true })
  logTo(b, 'bulk', 'loaded sample projects, people and tasks')
  await b.commit()
}

export const helpers = { shiftKey, rangeKeys }
