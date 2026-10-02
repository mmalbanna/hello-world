import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { saveSettings, seedSampleData, updateMyName } from '../lib/repo'
import { Button, Field, Input, PageHeader, Textarea } from '../components/ui'
import { clearLocalConfig } from '../lib/firebase'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Settings() {
  const settings = useStore((s) => s.settings)
  const profile = useStore((s) => s.profile)
  const isAdmin = useStore((s) => s.isAdmin)()
  const projects = useStore((s) => s.projects)
  const people = useStore((s) => s.people)
  const toast = useStore((s) => s.toast)

  const [orgName, setOrgName] = useState(settings.orgName)
  const [workingDays, setWorkingDays] = useState<number[]>(settings.workingDays)
  const [holidays, setHolidays] = useState(settings.holidays.join('\n'))
  const [disciplines, setDisciplines] = useState(settings.disciplines.join('\n'))
  const [titles, setTitles] = useState(settings.titles.join('\n'))
  const [rangeDays, setRangeDays] = useState(settings.defaultRangeDays)
  const [myName, setMyName] = useState(profile?.displayName ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setOrgName(settings.orgName); setWorkingDays(settings.workingDays); setHolidays(settings.holidays.join('\n'))
    setDisciplines(settings.disciplines.join('\n')); setTitles(settings.titles.join('\n')); setRangeDays(settings.defaultRangeDays)
  }, [settings])

  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

  const save = async () => {
    setBusy(true)
    try {
      await saveSettings({
        orgName: orgName.trim() || 'BIM Team',
        workingDays: [...workingDays].sort(),
        holidays: lines(holidays).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h)).sort(),
        disciplines: lines(disciplines),
        titles: lines(titles),
        defaultRangeDays: Math.min(Math.max(rangeDays, 5), 42),
      })
      toast('Settings saved', 'success')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const seed = async () => {
    if (!window.confirm('Load sample projects (P820, P860, P875, P880), team leads and modelers? Only possible while the workspace is empty.')) return
    setBusy(true)
    try { await seedSampleData(); toast('Sample data loaded', 'success') } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">My profile</h2>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Display name" className="flex-1"><Input value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
          <Button onClick={async () => { try { await updateMyName(profile!.uid, myName.trim()); toast('Name updated', 'success') } catch (e) { toast((e as Error).message, 'error') } }}>Save</Button>
        </div>
        <div className="mt-2 text-xs text-slate-500">Signed in as {profile?.email} · role: {profile?.role}</div>
      </section>

      {isAdmin && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Workspace</h2>
          <div className="mt-3 space-y-4">
            <Field label="Team / organisation name"><Input value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field>
            <Field group label="Working days" hint="Default Qatar week: Sunday to Thursday. Non-working days are greyed in the planner and skipped when filling a date range.">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" onClick={() => setWorkingDays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} className={`rounded-lg border px-3 py-1.5 text-sm ${workingDays.includes(i) ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{d}</button>
                ))}
              </div>
            </Field>
            <Field label="Public holidays" hint="One date per line, format YYYY-MM-DD."><Textarea value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-12-18" /></Field>
            <Field label="Disciplines" hint="One per line. Used for people, tasks and filters."><Textarea value={disciplines} onChange={(e) => setDisciplines(e.target.value)} /></Field>
            <Field label="Job titles" hint="One per line."><Textarea value={titles} onChange={(e) => setTitles(e.target.value)} /></Field>
            <Field label="Default planner range (days)"><Input type="number" min={5} max={42} value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))} className="max-w-[120px]" /></Field>
            <Button variant="primary" onClick={save} busy={busy}>Save settings</Button>
          </div>
        </section>
      )}

      {isAdmin && !projects.length && !people.length && (
        <section className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-4">
          <h2 className="font-semibold">Start quickly</h2>
          <p className="mt-1 text-sm text-slate-600">Load sample data with your four projects and example team leads and modelers. You can rename or delete anything afterwards.</p>
          <Button className="mt-3" onClick={seed} busy={busy}>Load sample data</Button>
        </section>
      )}

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Install on your device</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li><b>iPad / iPhone (Safari):</b> Share → Add to Home Screen.</li>
          <li><b>Android (Chrome):</b> menu ⋮ → Install app (or Add to Home screen).</li>
          <li><b>Windows / Mac (Edge or Chrome):</b> click the install icon in the address bar → Install.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">The installed app works offline and syncs as soon as it is online again.</p>
        <button className="mt-3 text-xs text-slate-500 underline" onClick={() => { clearLocalConfig(); location.reload() }}>Disconnect this device from the Firebase project</button>
      </section>
    </div>
  )
}
