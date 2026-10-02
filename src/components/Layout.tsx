import { NavLink, Outlet } from 'react-router-dom'
import { CalendarDays, FolderKanban, ListChecks, Users, FileOutput, Settings, Activity, ShieldCheck, LogOut, WifiOff, LayoutDashboard, Grid2x2, MoreHorizontal } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Toasts } from './ui'

const nav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/board', label: 'Sand table', icon: Grid2x2 },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/people', label: 'People', icon: Users },
  { to: '/reports', label: 'Share plan', icon: FileOutput },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/users', label: 'Access', icon: ShieldCheck, admin: true },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const profile = useStore((s) => s.profile)
  const online = useStore((s) => s.online)
  const signOut = useStore((s) => s.signOut)
  const settings = useStore((s) => s.settings)
  const dataError = useStore((s) => s.dataError)
  const isAdmin = profile?.role === 'admin'
  const items = nav.filter((n) => !n.admin || isAdmin)
  const mobileItems = [...items.filter((n) => ['/', '/board', '/calendar', '/tasks'].includes(n.to)), { to: '/more', label: 'More', icon: MoreHorizontal, end: false }]

  return (
    <div className="flex h-full flex-col md:flex-row">
      <Toasts />
      {/* Sidebar (tablet landscape / desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{settings.orgName}</div>
          <div className="text-lg font-bold text-brand">BIM Planner</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand/10 text-brand' : 'text-slate-700 hover:bg-slate-100'}`}>
              <n.icon className="h-5 w-5" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-sm">
          <div className="truncate font-medium text-slate-800">{profile?.displayName}</div>
          <div className="truncate text-xs text-slate-500">{profile?.email}</div>
          <div className="mt-1 text-xs capitalize text-slate-500">{profile?.role}</div>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 text-xs text-slate-600 hover:text-red-600"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      </aside>

      {/* Top bar (phone / tablet portrait) */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 safe-top md:hidden">
        <div className="text-base font-bold text-brand">BIM Planner</div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {!online && <WifiOff className="h-4 w-4 text-amber-600" />}
          <span className="truncate max-w-[120px]">{profile?.displayName}</span>
          <button onClick={signOut} aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="relative flex-1 overflow-auto">
        {!online && (
          <div className="sticky top-0 z-30 hidden items-center gap-2 bg-amber-100 px-4 py-1.5 text-xs text-amber-900 md:flex">
            <WifiOff className="h-4 w-4" /> Offline. Changes are saved on this device and will sync when you are back online.
          </div>
        )}
        <div className="mx-auto max-w-[1600px] p-3 pb-20 sm:p-4 md:pb-6">
          {dataError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Could not load part of the plan ({dataError}). If this persists, check that the Firestore rules were published and that your account has a role in Access.
            </div>
          )}
          <Outlet />
        </div>
      </main>

      {/* Bottom tabs (phone / tablet portrait) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white safe-bottom md:hidden">
        {mobileItems.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-slate-500'}`}>
            <n.icon className="h-5 w-5" /> {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
