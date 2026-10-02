import { create } from 'zustand'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  resolveConfig,
  initFirebase,
  getDb,
  getAuthInstance,
  saveConfigLocally,
  type FirebaseConfig,
} from '../lib/firebase'
import {
  DEFAULT_SETTINGS,
  type ActivityEntry,
  type Allocation,
  type Loan,
  type Person,
  type PlanEvent,
  type Project,
  type Settings,
  type Task,
  type UserProfile,
} from '../lib/types'
import { shiftKey, todayKey, weekStartKey } from '../lib/dates'

type ConfigStatus = 'loading' | 'missing' | 'ready'

interface State {
  configStatus: ConfigStatus
  authReady: boolean
  user: User | null
  profile: UserProfile | null
  profileError: string | null

  people: Person[]
  projects: Project[]
  tasks: Task[]
  allocations: Record<string, Allocation>
  allocRange: { start: string; end: string }
  settings: Settings
  activity: ActivityEntry[]
  loans: Loan[]
  events: PlanEvent[]
  users: UserProfile[]
  loaded: { people: boolean; projects: boolean; tasks: boolean; allocations: boolean; settings: boolean }
  online: boolean
  dataError: string | null

  // toasts
  toasts: { id: number; text: string; kind: 'info' | 'error' | 'success' }[]
  toast: (text: string, kind?: 'info' | 'error' | 'success') => void
  dismissToast: (id: number) => void

  boot: () => Promise<void>
  applyConfig: (c: FirebaseConfig) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
  setAllocRange: (start: string, end: string) => void

  // derived helpers
  canEdit: () => boolean
  isAdmin: () => boolean
  personById: (id: string) => Person | undefined
  projectById: (id: string) => Project | undefined
  taskById: (id: string) => Task | undefined
}

let subs: Unsubscribe[] = []
let allocSub: Unsubscribe | null = null
let toastSeq = 1
let lastActivitySeen: string | null = null

function clearSubs() {
  subs.forEach((u) => u())
  subs = []
  if (allocSub) allocSub()
  allocSub = null
}

export const useStore = create<State>((set, get) => ({
  configStatus: 'loading',
  authReady: false,
  user: null,
  profile: null,
  profileError: null,
  people: [],
  projects: [],
  tasks: [],
  allocations: {},
  allocRange: (() => {
    // wide enough for the overview (what happened / what is next) without resubscribing
    const start = weekStartKey(todayKey(), DEFAULT_SETTINGS)
    return { start: shiftKey(start, -56), end: shiftKey(start, 70) }
  })(),
  settings: DEFAULT_SETTINGS,
  activity: [],
  loans: [],
  events: [],
  users: [],
  loaded: { people: false, projects: false, tasks: false, allocations: false, settings: false },
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  dataError: null,
  toasts: [],

  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  boot: async () => {
    window.addEventListener('online', () => set({ online: true }))
    window.addEventListener('offline', () => set({ online: false }))
    const cfg = await resolveConfig()
    if (!cfg) {
      set({ configStatus: 'missing' })
      return
    }
    await get().applyConfig(cfg)
  },

  applyConfig: async (cfg) => {
    const { auth } = initFirebase(cfg)
    set({ configStatus: 'ready' })
    onAuthStateChanged(auth, async (user) => {
      clearSubs()
      set({ user, profile: null, profileError: null, authReady: true, loaded: { people: false, projects: false, tasks: false, allocations: false, settings: false } })
      if (!user) return
      try {
        await ensureProfile(user)
        subscribeAll(set, get)
      } catch (e) {
        set({ profileError: (e as Error).message })
      }
    })
  },

  signIn: async (email, password) => {
    await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password)
  },
  signUp: async (email, password, displayName) => {
    const cred = await createUserWithEmailAndPassword(getAuthInstance(), email.trim(), password)
    await updateProfile(cred.user, { displayName: displayName.trim() })
    await ensureProfile(cred.user, displayName.trim())
  },
  resetPassword: async (email) => {
    await sendPasswordResetEmail(getAuthInstance(), email.trim())
  },
  signOut: async () => {
    clearSubs()
    await fbSignOut(getAuthInstance())
  },

  setAllocRange: (start, end) => {
    const cur = get().allocRange
    if (cur.start <= start && cur.end >= end) return
    // widen with a buffer so week-to-week navigation does not resubscribe each time
    const nStart = start < cur.start ? shiftKey(start, -14) : cur.start
    const nEnd = end > cur.end ? shiftKey(end, 14) : cur.end
    set({ allocRange: { start: nStart, end: nEnd } })
    if (get().user) subscribeAllocations(set, get)
  },

  canEdit: () => {
    const r = get().profile?.role
    return r === 'admin' || r === 'lead'
  },
  isAdmin: () => get().profile?.role === 'admin',
  personById: (id) => get().people.find((p) => p.id === id),
  projectById: (id) => get().projects.find((p) => p.id === id),
  taskById: (id) => get().tasks.find((t) => t.id === id),
}))

async function ensureProfile(user: User, displayName?: string) {
  const db = getDb()
  const ref = doc(db, 'users', user.uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email ?? '',
      displayName: displayName || user.displayName || (user.email ?? '').split('@')[0],
      role: 'viewer',
      createdAt: serverTimestamp(),
    })
  }
}

type Set = (partial: Partial<State> | ((s: State) => Partial<State>)) => void
type Get = () => State

function subscribeAll(set: Set, get: Get) {
  const db = getDb()
  const user = get().user!
  const onErr = (what: string) => (e: Error) => {
    console.error(what, e)
    set({ dataError: `${what}: ${e.message}` })
  }

  subs.push(
    onSnapshot(doc(db, 'users', user.uid), (s) => {
      if (s.exists()) {
        const d = s.data()
        set({ profile: { uid: user.uid, email: d.email, displayName: d.displayName, role: d.role }, profileError: null })
      }
    }, onErr('profile')),
  )
  subs.push(
    onSnapshot(query(collection(db, 'people'), orderBy('order')), (s) => {
      set((st) => ({ people: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Person, 'id'>) })), loaded: { ...st.loaded, people: true }, dataError: null }))
    }, onErr('people')),
  )
  subs.push(
    onSnapshot(query(collection(db, 'projects'), orderBy('order')), (s) => {
      set((st) => ({ projects: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Project, 'id'>) })), loaded: { ...st.loaded, projects: true } }))
    }, onErr('projects')),
  )
  subs.push(
    onSnapshot(query(collection(db, 'tasks'), orderBy('order')), (s) => {
      set((st) => ({ tasks: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Task, 'id'>) })), loaded: { ...st.loaded, tasks: true } }))
    }, onErr('tasks')),
  )
  subs.push(
    onSnapshot(doc(db, 'settings', 'general'), (s) => {
      const data = s.exists() ? (s.data() as Partial<Settings>) : {}
      set((st) => ({ settings: { ...DEFAULT_SETTINGS, ...data }, loaded: { ...st.loaded, settings: true } }))
    }, onErr('settings')),
  )
  subs.push(
    onSnapshot(query(collection(db, 'activity'), orderBy('at', 'desc'), limit(150)), (s) => {
      const list = s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityEntry, 'id'>) }))
      // toast changes made by other people (only after the first load)
      const newest = list[0]
      if (lastActivitySeen !== null && newest && newest.id !== lastActivitySeen && newest.byUid !== user.uid && !s.metadata.hasPendingWrites) {
        get().toast(`${newest.byName}: ${newest.message}`, 'info')
      }
      lastActivitySeen = newest?.id ?? ''
      set({ activity: list })
    }, onErr('activity')),
  )
  subs.push(
    onSnapshot(query(collection(db, 'loans'), orderBy('createdAt', 'desc'), limit(300)), (s) => {
      set({ loans: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Loan, 'id'>) })) })
    }, onErr('loans')),
  )
  subs.push(
    onSnapshot(query(collection(db, 'events'), orderBy('at', 'desc'), limit(400)), (s) => {
      set({ events: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlanEvent, 'id'>) })) })
    }, onErr('events')),
  )
  // users list is only readable by viewers+; admins manage it
  subs.push(
    onSnapshot(collection(db, 'users'), (s) => {
      set({ users: s.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) })) })
    }, () => { /* non-fatal */ }),
  )
  subscribeAllocations(set, get)
}

function subscribeAllocations(set: Set, get: Get) {
  const db = getDb()
  if (allocSub) allocSub()
  const { start, end } = get().allocRange
  allocSub = onSnapshot(
    query(collection(db, 'allocations'), where('date', '>=', start), where('date', '<=', end)),
    (s) => {
      const map: Record<string, Allocation> = {}
      s.docs.forEach((d) => {
        map[d.id] = { id: d.id, ...(d.data() as Omit<Allocation, 'id'>) }
      })
      set((st) => ({ allocations: map, loaded: { ...st.loaded, allocations: true } }))
    },
    (e) => {
      console.error('allocations', e)
      set({ dataError: `allocations: ${e.message}` })
    },
  )
}

export { saveConfigLocally }
