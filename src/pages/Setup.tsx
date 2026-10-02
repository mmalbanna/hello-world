import { useState } from 'react'
import { useStore, saveConfigLocally } from '../store/useStore'
import type { FirebaseConfig } from '../lib/firebase'
import { Button, Textarea } from '../components/ui'

/** Shown only when no Firebase config is baked into the build. */
export default function Setup() {
  const applyConfig = useStore((s) => s.applyConfig)
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    try {
      // Accept either the JSON object or the JS snippet from the Firebase console.
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) throw new Error('Paste the firebaseConfig object from the Firebase console.')
      const jsonish = m[0]
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,\s*}/g, '}')
      const cfg = JSON.parse(jsonish) as FirebaseConfig
      for (const k of ['apiKey', 'authDomain', 'projectId', 'appId'] as const) if (!cfg[k]) throw new Error(`Missing ${k}`)
      saveConfigLocally(cfg)
      await applyConfig(cfg)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold text-brand">BIM Planner setup</h1>
      <p className="mt-2 text-sm text-slate-600">
        This copy of the app is not yet connected to a Firebase project. Paste the <b>firebaseConfig</b> from
        Firebase console → Project settings → Your apps (Web). For the whole team, put the same values into
        <code className="mx-1 rounded bg-slate-100 px-1">public/firebase-config.json</code> and redeploy so nobody has to do this step.
      </p>
      <Textarea className="mt-4 min-h-[180px] font-mono text-xs" placeholder={'{\n  apiKey: "...",\n  authDomain: "...firebaseapp.com",\n  projectId: "...",\n  appId: "..."\n}'} value={raw} onChange={(e) => setRaw(e.target.value)} />
      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
      <Button variant="primary" className="mt-4" onClick={submit}>Connect</Button>
    </div>
  )
}
