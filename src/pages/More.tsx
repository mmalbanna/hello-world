import { Link } from 'react-router-dom'
import { FolderKanban, Users, FileOutput, Activity, ShieldCheck, Settings, LogOut } from 'lucide-react'
import { useStore } from '../store/useStore'
import { PageHeader } from '../components/ui'

export default function More() {
  const profile = useStore((s) => s.profile)
  const signOut = useStore((s) => s.signOut)
  const items = [
    { to: '/projects', label: 'Projects', icon: FolderKanban, text: 'Codes, names and colours' },
    { to: '/people', label: 'People', icon: Users, text: 'Team, photos, subcontractors' },
    { to: '/reports', label: 'Share plan and reports', icon: FileOutput, text: 'Excel, Word, PDF, history' },
    { to: '/activity', label: 'Activity', icon: Activity, text: 'Who changed what' },
    ...(profile?.role === 'admin' ? [{ to: '/users', label: 'Access', icon: ShieldCheck, text: 'Roles for sign-in accounts' }] : []),
    { to: '/settings', label: 'Settings', icon: Settings, text: 'Working week, holidays, profile' },
  ]
  return (
    <div>
      <PageHeader title="More" subtitle={`${profile?.displayName} · ${profile?.role}`} />
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300">
            <i.icon className="h-6 w-6 text-brand" />
            <div><div className="font-semibold">{i.label}</div><div className="text-xs text-slate-500">{i.text}</div></div>
          </Link>
        ))}
        <button onClick={signOut} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-red-300"><LogOut className="h-6 w-6 text-red-600" /><div className="font-semibold">Sign out</div></button>
      </div>
    </div>
  )
}
