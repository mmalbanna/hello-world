import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

export interface FirebaseConfig extends FirebaseOptions {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

const LS_KEY = 'bimplanner.firebaseConfig'

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

function isUsable(c: Partial<FirebaseConfig> | null | undefined): c is FirebaseConfig {
  if (!c) return false
  const keys: (keyof FirebaseConfig)[] = ['apiKey', 'authDomain', 'projectId', 'appId']
  return keys.every((k) => typeof c[k] === 'string' && (c[k] as string).length > 0 && !(c[k] as string).includes('REPLACE_ME'))
}

function fromEnv(): Partial<FirebaseConfig> {
  const e = import.meta.env
  return {
    apiKey: e.VITE_FIREBASE_API_KEY,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: e.VITE_FIREBASE_PROJECT_ID,
    storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: e.VITE_FIREBASE_APP_ID,
  }
}

function fromLocalStorage(): Partial<FirebaseConfig> | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Partial<FirebaseConfig>) : null
  } catch {
    return null
  }
}

async function fromPublicJson(): Promise<Partial<FirebaseConfig> | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}firebase-config.json`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Partial<FirebaseConfig>
  } catch {
    return null
  }
}

/** Resolve config: build-time env > pasted (localStorage) > public/firebase-config.json */
export async function resolveConfig(): Promise<FirebaseConfig | null> {
  const env = fromEnv()
  if (isUsable(env)) return env
  const ls = fromLocalStorage()
  if (isUsable(ls)) return ls
  const pub = await fromPublicJson()
  if (isUsable(pub)) return pub
  return null
}

export function saveConfigLocally(c: FirebaseConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(c))
}
export function clearLocalConfig() {
  localStorage.removeItem(LS_KEY)
}

export function initFirebase(config: FirebaseConfig) {
  if (app) return { app, auth: auth!, db: db! }
  app = initializeApp(config)
  auth = getAuth(app)
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  // Local development against the Firebase Emulator Suite (npm run emulators).
  const emu = import.meta.env.VITE_FIREBASE_EMULATOR
  if (emu) {
    const host = typeof emu === 'string' && emu !== '1' && emu !== 'true' ? emu : '127.0.0.1'
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
    connectFirestoreEmulator(db, host, 8080)
  }
  return { app, auth, db }
}

export function getDb(): Firestore {
  if (!db) throw new Error('Firebase not initialised')
  return db
}
export function getAuthInstance(): Auth {
  if (!auth) throw new Error('Firebase not initialised')
  return auth
}
export function isInitialised() {
  return !!app
}
