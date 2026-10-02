import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/useStore'
import Layout from './components/Layout'
import { Spinner, Toasts } from './components/ui'
import Setup from './pages/Setup'
import SignIn from './pages/SignIn'
import Planner from './pages/Planner'
import Projects from './pages/Projects'
import Tasks from './pages/Tasks'
import People from './pages/People'
import Users from './pages/Users'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import ActivityPage from './pages/Activity'

export default function App() {
  const configStatus = useStore((s) => s.configStatus)
  const authReady = useStore((s) => s.authReady)
  const user = useStore((s) => s.user)
  const profile = useStore((s) => s.profile)
  const profileError = useStore((s) => s.profileError)
  const boot = useStore((s) => s.boot)
  const signOut = useStore((s) => s.signOut)

  useEffect(() => { boot() }, [boot])

  if (configStatus === 'loading') return <Spinner label="Starting" />
  if (configStatus === 'missing') return <Setup />
  if (!authReady) return <Spinner label="Checking sign-in" />
  if (!user) return <><Toasts /><SignIn /></>
  if (profileError) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <div className="font-semibold">Could not load your profile</div>
        <div className="mt-1">{profileError}</div>
        <div className="mt-3 text-xs text-red-700">Check that the Firestore rules from the repository were published, then try again.</div>
        <button className="mt-4 underline" onClick={signOut}>Sign out</button>
      </div>
    )
  }
  if (!profile) return <Spinner label="Loading your profile" />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Planner />} />
        <Route path="projects" element={<Projects />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="people" element={<People />} />
        <Route path="reports" element={<Reports />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="users" element={profile.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
